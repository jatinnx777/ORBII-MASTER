package com.orbii.app.mesh

import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Phase 0 of the offline mesh: a read-only capability probe.
 *
 * It reports what mesh radios THIS phone can offer, so we learn (from real
 * users, especially budget Android phones) what fraction can do BLE long range
 * (Coded PHY), Wi-Fi Aware, etc. before we build the mesh itself. Pure
 * capability queries: no scanning, no advertising, no runtime permissions.
 */
class OrbiiMeshModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "OrbiiMesh"

  // Receives helper-alert pings the service caught over Bluetooth, and re-emits
  // them to JS as events.
  private val meshRx = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      try {
        when (intent?.action) {
          OrbiiMeshService.HELPER_PING_RX_ACTION -> {
            val m = Arguments.createMap()
            m.putString("alertId", intent.getStringExtra(OrbiiMeshService.EXTRA_ALERT_ID) ?: "")
            m.putInt("rssi", intent.getIntExtra(OrbiiMeshService.EXTRA_ALERT_RSSI, -127))
            m.putDouble("at", System.currentTimeMillis().toDouble())
            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
              .emit("OrbiiHelperPing", m)
          }

          // A caught SOS the service could not upload. JS takes it into
          // hotPotatoVault and flushes it when this phone next has a connection.
          //
          // Dropping this event is SAFE, unlike dropping a helper ping: the
          // service already wrote the packet to MeshVault before broadcasting,
          // and drainNativeVault picks it up on the next launch. The emit is the
          // fast path, not the only one.
          OrbiiMeshService.UNBRIDGED_ACTION -> {
            val msgId = intent.getStringExtra(OrbiiMeshService.EXTRA_MSG_ID) ?: ""
            val sealed = intent.getStringExtra(OrbiiMeshService.EXTRA_SEALED) ?: ""
            if (msgId.isNotEmpty() && sealed.isNotEmpty()) {
              val m = Arguments.createMap()
              m.putString("msgId", msgId)
              m.putString("sealed", sealed)
              m.putDouble("at", System.currentTimeMillis().toDouble())
              ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("OrbiiMeshUnbridged", m)
            }
          }
        }
      } catch (e: Exception) {
        // JS bridge not ready; drop the event
      }
    }
  }

  init {
    try {
      val filter = IntentFilter().apply {
        addAction(OrbiiMeshService.HELPER_PING_RX_ACTION)
        addAction(OrbiiMeshService.UNBRIDGED_ACTION)
      }
      if (Build.VERSION.SDK_INT >= 33) {
        ctx.registerReceiver(meshRx, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        ctx.registerReceiver(meshRx, filter)
      }
    } catch (e: Exception) {
      // receiver already registered / context unavailable
    }
  }

  override fun invalidate() {
    try { ctx.unregisterReceiver(meshRx) } catch (e: Exception) {}
    super.invalidate()
  }

  /**
   * The vault bounds, as the single source of truth.
   *
   * These numbers govern how many of other people's emergencies this phone will
   * carry and for how long, and they are enforced in BOTH MeshVault.kt and
   * services/hotPotatoVault.ts. Two copies of a number that must agree is a
   * drift waiting to happen: raise the cap in Kotlin alone and the native store
   * holds 200 while JS silently discards half of them on the next drain.
   *
   * Kotlin owns them because Kotlin is where the packet is first written, before
   * any JS is guaranteed to be running. JS reads them from here.
   *
   * TTL crosses the bridge as a Double because a JS number IS a double and Long
   * does not survive the trip. 21,600,000 is far inside the 2^53 range where
   * doubles are exact, so nothing is lost.
   *
   * getConstants runs during module construction on the main thread. It must not
   * throw, or the whole native module fails to register and every mesh call
   * disappears, so the map is built defensively.
   */
  override fun getConstants(): Map<String, Any> = try {
    mapOf(
      "VAULT_MAX_ENTRIES" to MeshVault.MAX_ENTRIES,
      "VAULT_TTL_MS" to MeshVault.TTL_MS.toDouble(),
    )
  } catch (e: Exception) {
    emptyMap()
  }

  /**
   * Read the native store-and-forward queue without emptying it.
   *
   * Read and ack are separate on purpose. If reading cleared the store, a JS
   * crash between reading and persisting would destroy somebody's SOS. JS
   * acknowledges only after its own durable write, so the worst case is
   * delivering a packet twice, and the bridge already deduplicates on msgId.
   *
   * Resolves an empty array on any failure. A caller must never have to decide
   * whether an error means "empty" or "broken" while holding an emergency.
   */
  @ReactMethod
  fun readVault(promise: Promise) {
    try {
      val arr = Arguments.createArray()
      for (e in MeshVault.read(ctx)) {
        val m = Arguments.createMap()
        m.putString("msgId", e.msgId)
        m.putString("sealed", e.sealed)
        m.putDouble("heldSince", e.heldSince.toDouble())
        arr.pushMap(m)
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.resolve(Arguments.createArray())
    }
  }

  /** Forget packets JS has durably taken over. Resolves the number removed. */
  @ReactMethod
  fun ackVault(msgIds: com.facebook.react.bridge.ReadableArray, promise: Promise) {
    try {
      val ids = mutableListOf<String>()
      for (i in 0 until msgIds.size()) {
        msgIds.getString(i)?.let { if (it.isNotEmpty()) ids.add(it) }
      }
      promise.resolve(MeshVault.ack(ctx, ids))
    } catch (e: Exception) {
      promise.resolve(0)
    }
  }

  /** How many packets this phone is carrying for other people. */
  @ReactMethod
  fun vaultSize(promise: Promise) {
    try {
      promise.resolve(MeshVault.size(ctx))
    } catch (e: Exception) {
      promise.resolve(0)
    }
  }

  @ReactMethod
  fun getCapabilities(promise: Promise) {
    val m = Arguments.createMap()
    try {
      m.putInt("sdk", Build.VERSION.SDK_INT)
      m.putString("manufacturer", Build.MANUFACTURER ?: "")
      m.putString("model", Build.MODEL ?: "")

      val pm = ctx.packageManager
      val hasBle = pm.hasSystemFeature(PackageManager.FEATURE_BLUETOOTH_LE)
      val hasWifiAware = pm.hasSystemFeature(PackageManager.FEATURE_WIFI_AWARE)
      m.putBoolean("bleSupported", hasBle)
      m.putBoolean("wifiAwareSupported", hasWifiAware)

      var codedPhy = false
      var extAdv = false
      var twoMPhy = false
      var multiAdv = false
      var maxAdvLen = 31
      try {
        val bm = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = bm?.adapter
        if (adapter != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          codedPhy = adapter.isLeCodedPhySupported
          extAdv = adapter.isLeExtendedAdvertisingSupported
          twoMPhy = adapter.isLe2MPhySupported
          multiAdv = adapter.isMultipleAdvertisementSupported
          maxAdvLen = adapter.leMaximumAdvertisingDataLength
        }
      } catch (e: Exception) {
        // Some OEMs throw on these queries; leave conservative defaults.
      }
      m.putBoolean("leCodedPhySupported", codedPhy)
      m.putBoolean("leExtendedAdvertisingSupported", extAdv)
      m.putBoolean("le2MPhySupported", twoMPhy)
      m.putBoolean("multipleAdvertisementSupported", multiAdv)
      m.putInt("maxAdvertisingDataLength", maxAdvLen)

      // Best transport this phone can bring to the mesh.
      val tier = when {
        codedPhy && extAdv -> "boost_ble_long_range"
        hasWifiAware -> "boost_wifi_aware"
        hasBle -> "floor_ble"
        else -> "none"
      }
      m.putString("tier", tier)

      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("mesh_caps_failed", e)
    }
  }

  /**
   * Start relaying a sealed SOS packet over the mesh. The sealed blob is opaque
   * to native (crypto lives in JS); we only carry and re-broadcast it.
   */
  @ReactMethod
  fun armSosRelay(msgId: String, ttl: Double, sealedBase64: String, bridgeUrl: String, bearer: String, promise: Promise) {
    try {
      val intent = android.content.Intent(ctx, OrbiiMeshService::class.java).apply {
        action = OrbiiMeshService.ACTION_ARM
        putExtra(OrbiiMeshService.EXTRA_MSG_ID, msgId)
        putExtra(OrbiiMeshService.EXTRA_TTL, ttl.toInt())
        putExtra(OrbiiMeshService.EXTRA_SEALED, sealedBase64)
        putExtra(OrbiiMeshService.EXTRA_BRIDGE_URL, bridgeUrl)
        putExtra(OrbiiMeshService.EXTRA_BEARER, bearer)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
      else ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("mesh_arm_failed", e)
    }
  }

  /**
   * Listen-only: this phone scans for nearby SOS beacons and bridges/relays
   * them, without advertising an SOS of its own. Makes every open ORBII a
   * potential relay, which is what the mesh needs to actually work.
   */
  @ReactMethod
  fun startListening(bridgeUrl: String, bearer: String, promise: Promise) {
    try {
      val intent = android.content.Intent(ctx, OrbiiMeshService::class.java).apply {
        action = OrbiiMeshService.ACTION_LISTEN
        putExtra(OrbiiMeshService.EXTRA_BRIDGE_URL, bridgeUrl)
        putExtra(OrbiiMeshService.EXTRA_BEARER, bearer)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
      else ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("mesh_listen_failed", e)
    }
  }

  /** Stop advertising my own SOS, but keep listening/relaying for others. */
  @ReactMethod
  fun stopSosRelay(promise: Promise) {
    try {
      ctx.startService(
        android.content.Intent(ctx, OrbiiMeshService::class.java).apply {
          action = OrbiiMeshService.ACTION_STOP_SOS
        },
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun disarm(promise: Promise) {
    try {
      ctx.startService(
        android.content.Intent(ctx, OrbiiMeshService::class.java).apply {
          action = OrbiiMeshService.ACTION_DISARM
        },
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /** Victim: start broadcasting a location-free helper-alert ping. */
  @ReactMethod
  fun armHelperPing(alertId: String, ttl: Double, promise: Promise) {
    try {
      val intent = Intent(ctx, OrbiiMeshService::class.java).apply {
        action = OrbiiMeshService.ACTION_HELPER_PING
        putExtra(OrbiiMeshService.EXTRA_ALERT_ID, alertId)
        putExtra(OrbiiMeshService.EXTRA_TTL, ttl.toInt())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
      else ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("mesh_helper_ping_failed", e)
    }
  }

  /** Victim: stop the helper-alert ping (SOS resolved / cancelled). */
  @ReactMethod
  fun stopHelperPing(promise: Promise) {
    try {
      ctx.startService(
        Intent(ctx, OrbiiMeshService::class.java).apply {
          action = OrbiiMeshService.ACTION_STOP_HELPER_PING
        },
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
