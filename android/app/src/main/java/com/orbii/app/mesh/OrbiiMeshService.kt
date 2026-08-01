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
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
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

  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null

  // The packet this phone is currently relaying (its own SOS, or one it caught).
  @Volatile private var curMsgId: String? = null
  @Volatile private var curTtl: Int = 0
  @Volatile private var curBlob: ByteArray = ByteArray(0)
  private var bridgeUrl: String? = null
  private var bearer: String? = null

  private val seen = ConcurrentHashMap.newKeySet<String>()

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
    val adapter = bm?.adapter ?: run { stopSelf(); return }
    advertiser = adapter.bluetoothLeAdvertiser
    scanner = adapter.bluetoothLeScanner

    startGattServer(bm)
    startAdvertising()
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

  @SuppressLint("MissingPermission")
  private fun startScanning() {
    val sc = scanner ?: return
    val filter = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build()
    val settings = ScanSettings.Builder()
      .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
      .build()
    try {
      sc.startScan(listOf(filter), settings, scanCb)
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
      // New packet: connect and read the full sealed blob, then relay/bridge.
      val device = result.device ?: return
      try {
        device.connectGatt(this@OrbiiMeshService, false, gattClientCbFor(msgId, ttl))
      } catch (e: Exception) {
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
      startAdvertising() // re-broadcast the beacon with decremented TTL
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
    try { scanner?.stopScan(scanCb) } catch (e: Exception) {}
    try { gattServer?.close() } catch (e: Exception) {}
    advertiser = null; scanner = null; gattServer = null
    seen.clear()
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
