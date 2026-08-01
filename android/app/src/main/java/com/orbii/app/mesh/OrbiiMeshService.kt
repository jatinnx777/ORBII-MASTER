package com.orbii.app.mesh

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.AdvertisingSet
import android.bluetooth.le.AdvertisingSetCallback
import android.bluetooth.le.AdvertisingSetParameters
import android.bluetooth.le.BluetoothLeAdvertiser
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.ParcelUuid
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Offline mesh relay — Phase 1, FIRST CUT (needs on-device testing).
 *
 * Universal BLE floor: advertise a tiny SOS beacon (service data = 4-byte msgId
 * + 1-byte TTL) that fits legacy 31-byte advertising and so works on any BLE
 * phone. The full SEALED payload is served over a GATT characteristic, so peers
 * connect and read the opaque blob (relays never decrypt it). Managed flooding:
 * dedup by msgId, decrement TTL, re-advertise + serve if TTL > 0. If this phone
 * has internet, it POSTs the blob to the mesh-bridge function.
 *
 * This is the radio layer. It carries opaque bytes only; all crypto lives in
 * JS/Deno. Coded PHY / Wi-Fi Aware boosts are Phase 2, layered on top of this.
 */
class OrbiiMeshService : Service() {

  companion object {
    const val ACTION_ARM = "com.orbii.app.mesh.ARM"
    const val ACTION_DISARM = "com.orbii.app.mesh.DISARM"
    const val EXTRA_MSG_ID = "msgId" // 8 hex chars (4 bytes)
    const val EXTRA_TTL = "ttl"
    const val EXTRA_SEALED = "sealed" // base64, opaque
    const val EXTRA_BRIDGE_URL = "bridgeUrl"
    const val EXTRA_BEARER = "bearer"

    // Fixed ORBII mesh identifiers (valid hex UUIDs).
    val SERVICE_UUID: UUID = UUID.fromString("0ab11000-0000-4000-8000-000000000500")
    val PAYLOAD_UUID: UUID = UUID.fromString("0ab11000-0000-4000-8000-000000000501")

    private const val CHANNEL = "orbii_mesh"
    private const val NOTIF_ID = 4120
  }

  private var adapter: BluetoothAdapter? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null
  private var extAdvertisingSet: AdvertisingSet? = null
  // Phase 2: does this phone support the long-range boost (Coded PHY + extended
  // advertising)? Detected at start; capable phones ALSO run the boosted advert
  // (which carries the full sealed blob inline, no GATT), while every phone keeps
  // the legacy beacon so budget phones stay in the mesh.
  private var boostCapable = false

  // The packet this phone is currently relaying (its own SOS, or one it caught).
  @Volatile private var curMsgId: String? = null
  @Volatile private var curTtl: Int = 0
  @Volatile private var curBlob: ByteArray = ByteArray(0)
  private var bridgeUrl: String? = null
  private var bearer: String? = null

  private val seen = ConcurrentHashMap.newKeySet<String>()
  // msgIds we're mid-GATT-connect for, so a LOW_LATENCY scan's repeated
  // callbacks don't spawn a storm of duplicate connections for the same beacon.
  private val connecting = ConcurrentHashMap.newKeySet<String>()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_DISARM -> { teardown(); stopSelf(); return START_NOT_STICKY }
      ACTION_ARM -> {
        curMsgId = intent.getStringExtra(EXTRA_MSG_ID)
        curTtl = intent.getIntExtra(EXTRA_TTL, 5)
        curBlob = android.util.Base64.decode(intent.getStringExtra(EXTRA_SEALED) ?: "", android.util.Base64.NO_WRAP)
        bridgeUrl = intent.getStringExtra(EXTRA_BRIDGE_URL)
        bearer = intent.getStringExtra(EXTRA_BEARER)
        curMsgId?.let { seen.add(it) }
        startForegroundSafely()
        start()
      }
    }
    return START_STICKY
  }

  private fun startForegroundSafely() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Offline relay", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val notif: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("ORBII is relaying an SOS")
      .setContentText("Passing an emergency alert to nearby phones, offline.")
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .build()
    startForeground(NOTIF_ID, notif)
  }

  @SuppressLint("MissingPermission")
  private fun start() {
    val bm = getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
    val a = bm?.adapter ?: run { stopSelf(); return }
    adapter = a
    advertiser = a.bluetoothLeAdvertiser
    scanner = a.bluetoothLeScanner
    boostCapable = try {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        a.isLeExtendedAdvertisingSupported && a.isLeCodedPhySupported
    } catch (e: Exception) {
      false
    }

    startGattServer(bm)
    startAdvertising()
    if (boostCapable) startExtendedAdvertising()
    startScanning()
  }

  @SuppressLint("MissingPermission")
  private fun startGattServer(bm: BluetoothManager) {
    try {
      val server = bm.openGattServer(this, gattServerCb)
      val svc = BluetoothGattService(SERVICE_UUID, BluetoothGattService.SERVICE_TYPE_PRIMARY)
      val chr = BluetoothGattCharacteristic(
        PAYLOAD_UUID,
        BluetoothGattCharacteristic.PROPERTY_READ,
        BluetoothGattCharacteristic.PERMISSION_READ,
      )
      svc.addCharacteristic(chr)
      server.addService(svc)
      gattServer = server
    } catch (e: Exception) {
      // GATT server unavailable; scanning/relaying degrade but do not crash.
    }
  }

  private val gattServerCb = object : BluetoothGattServerCallback() {
    @SuppressLint("MissingPermission")
    override fun onCharacteristicReadRequest(
      device: android.bluetooth.BluetoothDevice?,
      requestId: Int,
      offset: Int,
      characteristic: BluetoothGattCharacteristic?,
    ) {
      // Serve the current opaque blob to any peer that connects and reads it.
      val blob = curBlob
      val slice = if (offset >= blob.size) ByteArray(0) else blob.copyOfRange(offset, blob.size)
      try {
        gattServer?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, offset, slice)
      } catch (e: Exception) {
        // peer gone
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun startAdvertising() {
    val msgId = curMsgId ?: return
    val adv = advertiser ?: return
    // Beacon: service UUID + service-data [ msgIdBytes(4) | ttl(1) ]. Fits legacy 31B.
    val idBytes = hexToBytes(msgId)
    val serviceData = idBytes.copyOf(4) + byteArrayOf(curTtl.toByte())
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .addServiceData(ParcelUuid(SERVICE_UUID), serviceData)
      .build()
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(true)
      .build()
    try {
      adv.stopAdvertising(advCb)
      adv.startAdvertising(settings, data, advCb)
    } catch (e: Exception) {
      // advertising unsupported/failed
    }
  }

  private val advCb = object : AdvertiseCallback() {}

  // Phase 2 boost: an extended advertisement over Coded PHY that carries the
  // FULL sealed blob inline (no GATT connect needed) and reaches much further.
  // Only capable phones run this, in addition to the legacy beacon above, so
  // budget phones still see the mesh via the beacon + GATT.
  @SuppressLint("MissingPermission")
  private fun startExtendedAdvertising() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val msgId = curMsgId ?: return
    val adv = advertiser ?: return
    val blob = curBlob
    if (blob.isEmpty()) return
    val idBytes = hexToBytes(msgId)
    val serviceData = idBytes.copyOf(4) + byteArrayOf(curTtl.toByte()) + blob
    val maxLen = try { adapter?.leMaximumAdvertisingDataLength ?: 0 } catch (e: Exception) { 0 }
    if (maxLen in 1..(serviceData.size + 24)) return // won't fit on this device
    val params = AdvertisingSetParameters.Builder()
      .setLegacyMode(false)
      .setConnectable(false)
      .setScannable(false)
      .setInterval(AdvertisingSetParameters.INTERVAL_LOW)
      .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
      .setPrimaryPhy(BluetoothDevice.PHY_LE_CODED)
      .setSecondaryPhy(BluetoothDevice.PHY_LE_CODED)
      .build()
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(SERVICE_UUID))
      .addServiceData(ParcelUuid(SERVICE_UUID), serviceData)
      .build()
    try {
      adv.stopAdvertisingSet(extAdvCb)
      adv.startAdvertisingSet(params, data, null, null, null, extAdvCb)
    } catch (e: Exception) {
      // boost failed; the legacy beacon still carries the mesh
    }
  }

  private val extAdvCb = object : AdvertisingSetCallback() {
    override fun onAdvertisingSetStarted(set: AdvertisingSet?, txPower: Int, status: Int) {
      extAdvertisingSet = set
    }
  }

  @SuppressLint("MissingPermission")
  private fun startScanning() {
    val sc = scanner ?: return
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val builder = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
    // Capable phones scan for BOTH legacy and extended (Coded PHY) adverts.
    if (boostCapable && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        builder.setLegacy(false)
        builder.setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
      } catch (e: Exception) {
        // fall back to legacy scan settings
      }
    }
    try {
      sc.startScan(listOf(filter), builder.build(), scanCb)
    } catch (e: Exception) {
      // scanning unsupported/failed
    }
  }

  private val scanCb = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
      val rec = result?.scanRecord ?: return
      val sd = rec.getServiceData(ParcelUuid(SERVICE_UUID)) ?: return
      if (sd.size < 5) return
      val msgId = bytesToHex(sd.copyOf(4))
      val ttl = sd[4].toInt() and 0xFF
      if (seen.contains(msgId)) return
      // Boosted (extended) advert carries the full sealed blob inline: use it
      // directly, no GATT round-trip.
      if (sd.size > 5) {
        handleIncoming(msgId, ttl, sd.copyOfRange(5, sd.size))
        return
      }
      // Legacy beacon (5 bytes): connect and read the blob over GATT. Guard so
      // repeated scan callbacks for the same beacon don't stack connections.
      if (!connecting.add(msgId)) return
      val device = result.device ?: run { connecting.remove(msgId); return }
      try {
        device.connectGatt(this@OrbiiMeshService, false, gattClientCbFor(msgId, ttl))
      } catch (e: Exception) {
        connecting.remove(msgId)
        // could not connect; another relay may still carry it
      }
    }
  }

  @SuppressLint("MissingPermission")
  private fun gattClientCbFor(msgId: String, ttl: Int) = object : BluetoothGattCallback() {
    override fun onConnectionStateChange(gatt: BluetoothGatt?, status: Int, newState: Int) {
      if (newState == BluetoothProfile.STATE_CONNECTED) {
        try { gatt?.discoverServices() } catch (e: Exception) {}
      } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
        connecting.remove(msgId)
        try { gatt?.close() } catch (e: Exception) {}
      }
    }

    override fun onServicesDiscovered(gatt: BluetoothGatt?, status: Int) {
      val chr = gatt?.getService(SERVICE_UUID)?.getCharacteristic(PAYLOAD_UUID)
      if (chr != null) {
        try { gatt.readCharacteristic(chr) } catch (e: Exception) {}
      } else {
        try { gatt?.disconnect() } catch (e: Exception) {}
      }
    }

    @Deprecated("Deprecated in Java")
    override fun onCharacteristicRead(gatt: BluetoothGatt?, characteristic: BluetoothGattCharacteristic?, status: Int) {
      val blob = characteristic?.value
      try { gatt?.disconnect() } catch (e: Exception) {}
      if (status == BluetoothGatt.GATT_SUCCESS && blob != null && blob.isNotEmpty()) {
        handleIncoming(msgId, ttl, blob)
      }
    }
  }

  private fun handleIncoming(msgId: String, ttl: Int, blob: ByteArray) {
    if (!seen.add(msgId)) return // race: already handled
    // Bridge to the server if we have internet (best-effort, on a worker thread).
    Thread { tryBridge(msgId, blob) }.start()
    // Keep flooding if the packet still has hops left.
    val nextTtl = ttl - 1
    if (nextTtl > 0) {
      curMsgId = msgId
      curTtl = nextTtl
      curBlob = blob
      startAdvertising() // re-broadcast the beacon (all phones)
      if (boostCapable) startExtendedAdvertising() // + the long-range boost
    }
  }

  private fun tryBridge(msgId: String, blob: ByteArray) {
    val url = bridgeUrl ?: return
    try {
      val conn = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 8000
        readTimeout = 8000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        bearer?.let { setRequestProperty("Authorization", "Bearer $it") }
      }
      val sealedB64 = android.util.Base64.encodeToString(blob, android.util.Base64.NO_WRAP)
      val body = "{\"msgId\":\"$msgId\",\"sealed\":\"$sealedB64\"}"
      conn.outputStream.use { it.write(body.toByteArray()) }
      conn.inputStream.use { it.readBytes() } // drain; 2xx = bridged
      conn.disconnect()
    } catch (e: Exception) {
      // No internet on this phone (expected for most relays) — someone else bridges.
    }
  }

  @SuppressLint("MissingPermission")
  private fun teardown() {
    try { advertiser?.stopAdvertising(advCb) } catch (e: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try { advertiser?.stopAdvertisingSet(extAdvCb) } catch (e: Exception) {}
    }
    try { scanner?.stopScan(scanCb) } catch (e: Exception) {}
    try { gattServer?.close() } catch (e: Exception) {}
    advertiser = null; scanner = null; gattServer = null; extAdvertisingSet = null; adapter = null
    seen.clear()
    connecting.clear()
  }

  override fun onDestroy() {
    teardown()
    super.onDestroy()
  }

  private fun hexToBytes(hex: String): ByteArray {
    val clean = hex.filter { it.isLetterOrDigit() }
    val out = ByteArray(clean.length / 2)
    for (i in out.indices) {
      out[i] = ((Character.digit(clean[i * 2], 16) shl 4) + Character.digit(clean[i * 2 + 1], 16)).toByte()
    }
    return out
  }

  private fun bytesToHex(b: ByteArray): String {
    val sb = StringBuilder()
    for (x in b) sb.append(String.format("%02x", x))
    return sb.toString()
  }
}
