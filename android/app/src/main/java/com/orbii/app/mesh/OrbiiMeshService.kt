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
    const val ACTION_LISTEN = "com.orbii.app.mesh.LISTEN"
    const val ACTION_STOP_SOS = "com.orbii.app.mesh.STOP_SOS"
    // Offline helper alert: broadcast a location-free "someone near me needs
    // help" ping; nearby helpers home in by signal strength.
    const val ACTION_HELPER_PING = "com.orbii.app.mesh.HELPER_PING"
    const val ACTION_STOP_HELPER_PING = "com.orbii.app.mesh.STOP_HELPER_PING"
    const val ACTION_DISARM = "com.orbii.app.mesh.DISARM"
    const val EXTRA_MSG_ID = "msgId" // 8 hex chars (4 bytes)
    const val EXTRA_TTL = "ttl"
    const val EXTRA_SEALED = "sealed" // base64, opaque
    const val EXTRA_BRIDGE_URL = "bridgeUrl"
    const val EXTRA_BEARER = "bearer"
    const val EXTRA_ALERT_ID = "alertId"
    const val EXTRA_ALERT_RSSI = "alertRssi"

    // A caught helper-alert ping (with live signal strength) is delivered the
    // same way, so the helper's UI can show a warmer/colder homing meter.
    const val HELPER_PING_RX_ACTION = "com.orbii.app.mesh.HELPER_PING_RX"

    // A packet we caught but could not hand to the server. Broadcast so JS can
    // take it into services/hotPotatoVault.ts, which owns the retry policy and
    // the connectivity subscription. Also written to MeshVault first, because
    // the JS side may not be alive to hear this.
    const val UNBRIDGED_ACTION = "com.orbii.app.mesh.UNBRIDGED"

    // Fixed ORBII mesh identifiers (valid hex UUIDs).
    val SERVICE_UUID: UUID = UUID.fromString("0ab11000-0000-4000-8000-000000000500")
    val PAYLOAD_UUID: UUID = UUID.fromString("0ab11000-0000-4000-8000-000000000501")
    // Offline helper-alert channel. A tiny legacy beacon (fits any BLE phone) so
    // the "someone near me needs help" ping reaches every nearby ORBII, not just
    // long-range-capable ones. Carries NO location, only a random alert id.
    val ALERT_SERVICE_UUID: UUID = UUID.fromString("0ab11000-0000-4000-8000-000000000520")

    private const val CHANNEL = "orbii_mesh"
    private const val NOTIF_ID = 4120
  }

  private var adapter: BluetoothAdapter? = null
  private var advertiser: BluetoothLeAdvertiser? = null
  private var scanner: BluetoothLeScanner? = null
  private var gattServer: BluetoothGattServer? = null
  private var extAdvertisingSet: AdvertisingSet? = null
  // Long-range tuning: if a Coded-PHY (long range) advertising set fails to
  // start on this phone, we fall back to a 1M-PHY extended advert (still carries
  // the full blob inline, better than nothing) instead of silently dropping the
  // boost. This flag flips after the first Coded-PHY failure.
  private var extUsedFallback = false
  // Phase 2: does this phone support the long-range boost (Coded PHY + extended
  // advertising)? Detected at start; capable phones ALSO run the boosted advert
  // (which carries the full sealed blob inline, no GATT), while every phone keeps
  // the legacy beacon so budget phones stay in the mesh.
  private var boostCapable = false

  // The packet this phone is currently relaying (its own SOS, or one it caught).
  @Volatile private var curMsgId: String? = null
  @Volatile private var curTtl: Int = 0
  @Volatile private var curBlob: ByteArray = ByteArray(0)
  // The helper-alert ping this phone is currently broadcasting (victim side).
  @Volatile private var curAlertId: String? = null
  @Volatile private var curAlertTtl: Int = 0
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
      // Listen-only: a bystander phone scans for nearby SOS beacons and bridges
      // / relays them, WITHOUT advertising an SOS of its own. This is what makes
      // the mesh actually work: relays have to be listening.
      ACTION_LISTEN -> {
        bridgeUrl = intent.getStringExtra(EXTRA_BRIDGE_URL)
        bearer = intent.getStringExtra(EXTRA_BEARER)
        startForegroundSafely()
        start() // curMsgId is null → advertises nothing, just scans + GATT server
      }
      // My SOS resolved: stop advertising it, but keep listening/relaying for
      // others (don't tear the whole service down).
      ACTION_STOP_SOS -> {
        stopOwnAdvertising()
        curMsgId = null; curTtl = 0; curBlob = ByteArray(0)
      }
      // Victim: broadcast a location-free helper ping so nearby helpers can find
      // her by signal strength. Single hop by design (proximity homing only
      // makes sense within direct radio range).
      ACTION_HELPER_PING -> {
        curAlertId = intent.getStringExtra(EXTRA_ALERT_ID)
        curAlertTtl = intent.getIntExtra(EXTRA_TTL, 1)
        ensureStarted()
        startAlertAdvertising()
      }
      ACTION_STOP_HELPER_PING -> {
        stopAlertAdvertising()
        curAlertId = null; curAlertTtl = 0
      }
    }
    return START_STICKY
  }

  // Bring the radio up if the service was cold-started straight into a helper
  // ping (normally LISTEN mode has already run on every authenticated phone).
  @SuppressLint("MissingPermission")
  private fun ensureStarted() {
    if (adapter == null) {
      startForegroundSafely()
      start()
    }
  }

  @SuppressLint("MissingPermission")
  private fun stopOwnAdvertising() {
    try { advertiser?.stopAdvertising(advCb) } catch (e: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try { advertiser?.stopAdvertisingSet(extAdvCb) } catch (e: Exception) {}
    }
  }

  private fun startForegroundSafely() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Offline relay", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val relaying = curMsgId != null
    val notif: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle(if (relaying) "ORBII is relaying an SOS" else "ORBII offline safety net")
      .setContentText(
        if (relaying) "Passing an emergency alert to nearby phones, offline."
        else "Listening for nearby SOS that need a relay to the internet.",
      )
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
    extUsedFallback = false // give Coded PHY a fresh try each session

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
    // Prefer Coded PHY (long range); after a Coded-PHY start failure on this
    // phone, fall back to 1M PHY extended so we still get the inline-blob advert.
    val phy = if (extUsedFallback) BluetoothDevice.PHY_LE_1M else BluetoothDevice.PHY_LE_CODED
    val params = AdvertisingSetParameters.Builder()
      .setLegacyMode(false)
      .setConnectable(false)
      .setScannable(false)
      .setInterval(AdvertisingSetParameters.INTERVAL_LOW)
      .setTxPowerLevel(AdvertisingSetParameters.TX_POWER_HIGH)
      .setPrimaryPhy(phy)
      .setSecondaryPhy(phy)
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
      if (status == AdvertisingSetCallback.ADVERTISE_SUCCESS) {
        extAdvertisingSet = set
      } else if (!extUsedFallback) {
        // Coded PHY refused on this phone; retry once on 1M PHY extended.
        extUsedFallback = true
        startExtendedAdvertising()
      }
    }
  }

  // ---- Offline helper alert ----------------------------------------------
  // Victim broadcasts a tiny legacy beacon on the ALERT channel:
  //   [ alertId(4) | ttl(1) ]   (NO location, ever)
  // Nearby helper phones catch it while scanning and stream its signal strength
  // to the app so the helper can walk warmer/colder toward her.
  @SuppressLint("MissingPermission")
  private fun startAlertAdvertising() {
    val alertId = curAlertId ?: return
    val adv = advertiser ?: return
    val idBytes = hexToBytes(alertId).copyOf(4)
    val serviceData = idBytes + byteArrayOf(curAlertTtl.toByte())
    val data = AdvertiseData.Builder()
      .setIncludeDeviceName(false)
      .addServiceUuid(ParcelUuid(ALERT_SERVICE_UUID))
      .addServiceData(ParcelUuid(ALERT_SERVICE_UUID), serviceData)
      .build()
    val settings = AdvertiseSettings.Builder()
      .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
      .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
      .setConnectable(false)
      .build()
    try {
      adv.stopAdvertising(alertAdvCb)
      adv.startAdvertising(settings, data, alertAdvCb)
    } catch (e: Exception) {
      // alert advertising failed; SMS + circle mesh still cover the SOS
    }
  }

  private val alertAdvCb = object : AdvertiseCallback() {}

  @SuppressLint("MissingPermission")
  private fun stopAlertAdvertising() {
    try { advertiser?.stopAdvertising(alertAdvCb) } catch (e: Exception) {}
  }

  private fun handleAlertPing(result: ScanResult, sd: ByteArray) {
    val alertId = bytesToHex(sd.copyOf(4))
    if (alertId == curAlertId) return // don't alert on my own ping
    // Stream every sighting (with signal strength) to the app for homing.
    try {
      val i = Intent(HELPER_PING_RX_ACTION)
        .setPackage(packageName)
        .putExtra(EXTRA_ALERT_ID, alertId)
        .putExtra(EXTRA_ALERT_RSSI, result.rssi)
      sendBroadcast(i)
    } catch (e: Exception) {}
  }

  @SuppressLint("MissingPermission")
  private fun startScanning() {
    val sc = scanner ?: return
    // Two channels: SOS beacons and helper-alert pings.
    val filters = listOf(
      ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICE_UUID)).build(),
      ScanFilter.Builder().setServiceUuid(ParcelUuid(ALERT_SERVICE_UUID)).build(),
    )
    val builder = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
    // Any phone that supports extended advertising scans for BOTH legacy and
    // extended adverts (setLegacy(false) reports both), so the long-range
    // (Coded PHY) boosted SOS advert is received alongside the legacy beacon.
    val extScanCapable = try {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && (adapter?.isLeExtendedAdvertisingSupported ?: false)
    } catch (e: Exception) {
      false
    }
    if (extScanCapable) {
      try {
        builder.setLegacy(false)
        builder.setPhy(ScanSettings.PHY_LE_ALL_SUPPORTED)
      } catch (e: Exception) {
        // fall back to legacy scan settings
      }
    }
    try {
      sc.startScan(filters, builder.build(), scanCb)
    } catch (e: Exception) {
      // scanning unsupported/failed
    }
  }

  private val scanCb = object : ScanCallback() {
    @SuppressLint("MissingPermission")
    override fun onScanResult(callbackType: Int, result: ScanResult?) {
      val rec = result?.scanRecord ?: return
      // Helper-alert ping channel (stream signal strength for homing).
      rec.getServiceData(ParcelUuid(ALERT_SERVICE_UUID))?.let {
        if (it.size >= 5) handleAlertPing(result, it)
        return
      }
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

  /**
   * Hand the packet to the server, or keep it.
   *
   * WHAT THIS USED TO DO. The catch was empty, with the comment "someone else
   * bridges". Usually someone does. When nobody in range has internet, an SOS
   * that physically reached a stranger's phone died on it, and that relay very
   * often walks into wifi four minutes later still carrying the answer.
   *
   * The response code is now read explicitly rather than inferred from whether
   * inputStream threw. A 4xx counts as delivered: the usual 4xx here is the
   * bridge rejecting a duplicate it already holds, which means the SOS arrived by
   * another route and retrying it forever is noise. A 5xx is the server having a
   * bad day and IS worth carrying.
   */
  private fun tryBridge(msgId: String, blob: ByteArray) {
    val sealedB64 = try {
      android.util.Base64.encodeToString(blob, android.util.Base64.NO_WRAP)
    } catch (e: Exception) {
      return // cannot encode it, cannot store it, nothing useful left to do
    }

    val url = bridgeUrl
    if (url == null) {
      vaultUnbridged(msgId, sealedB64)
      return
    }

    var conn: java.net.HttpURLConnection? = null
    try {
      conn = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = 8000
        readTimeout = 8000
        doOutput = true
        setRequestProperty("Content-Type", "application/json")
        bearer?.let { setRequestProperty("Authorization", "Bearer $it") }
      }
      val body = "{\"msgId\":\"$msgId\",\"sealed\":\"$sealedB64\"}"
      conn.outputStream.use { it.write(body.toByteArray()) }

      val code = conn.responseCode
      if (code in 200..299) {
        try { conn.inputStream.use { it.readBytes() } } catch (e: Exception) {}
        return
      }
      if (code in 400..499) {
        // Already have it, or it will never be accepted. Either way, done.
        try { conn.errorStream?.use { it.readBytes() } } catch (e: Exception) {}
        return
      }
      try { conn.errorStream?.use { it.readBytes() } } catch (e: Exception) {}
      vaultUnbridged(msgId, sealedB64)
    } catch (e: Exception) {
      // No internet on this phone, which is the expected state for most relays.
      vaultUnbridged(msgId, sealedB64)
    } finally {
      try { conn?.disconnect() } catch (e: Exception) {}
    }
  }

  /**
   * Keep an undelivered packet, and tell JS about it if JS is listening.
   *
   * Both, not either. The broadcast is the fast path for a live app, which can
   * flush the moment connectivity returns. MeshVault is the slow path for a
   * service running with the RN instance torn down or started on boot, where the
   * emit reaches nobody.
   *
   * Fails silently by design. This is called from the middle of the relay loop,
   * and losing one packet must never take the radio layer down with it.
   */
  private fun vaultUnbridged(msgId: String, sealedB64: String) {
    try {
      MeshVault.hold(applicationContext, msgId, sealedB64)
    } catch (e: Exception) {
      // Storage unavailable. The broadcast below may still save it.
    }
    try {
      val i = Intent(UNBRIDGED_ACTION)
        .setPackage(packageName)
        .putExtra(EXTRA_MSG_ID, msgId)
        .putExtra(EXTRA_SEALED, sealedB64)
      sendBroadcast(i)
    } catch (e: Exception) {
      // No JS bridge, or the context is going away. MeshVault has it.
    }
  }

  @SuppressLint("MissingPermission")
  private fun teardown() {
    try { advertiser?.stopAdvertising(advCb) } catch (e: Exception) {}
    try { advertiser?.stopAdvertising(alertAdvCb) } catch (e: Exception) {}
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try { advertiser?.stopAdvertisingSet(extAdvCb) } catch (e: Exception) {}
    }
    try { scanner?.stopScan(scanCb) } catch (e: Exception) {}
    try { gattServer?.close() } catch (e: Exception) {}
    advertiser = null; scanner = null; gattServer = null
    extAdvertisingSet = null; adapter = null
    curAlertId = null; curAlertTtl = 0
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
