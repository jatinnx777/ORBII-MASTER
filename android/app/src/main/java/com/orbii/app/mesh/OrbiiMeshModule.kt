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

  // Receives chat messages the service caught over Bluetooth and re-emits them
  // to JS as an "OrbiiMeshChat" event.
  private val chatRx = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action != OrbiiMeshService.CHAT_RX_ACTION) return
      try {
        val m = Arguments.createMap()
        m.putString("sender", intent.getStringExtra(OrbiiMeshService.EXTRA_CHAT_SENDER) ?: "")
        m.putString("text", intent.getStringExtra(OrbiiMeshService.EXTRA_CHAT_TEXT) ?: "")
        m.putDouble("at", System.currentTimeMillis().toDouble())
        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("OrbiiMeshChat", m)
      } catch (e: Exception) {
        // JS bridge not ready; drop the message
      }
    }
  }

  init {
    try {
      val filter = IntentFilter(OrbiiMeshService.CHAT_RX_ACTION)
      if (Build.VERSION.SDK_INT >= 33) {
        ctx.registerReceiver(chatRx, filter, Context.RECEIVER_NOT_EXPORTED)
      } else {
        ctx.registerReceiver(chatRx, filter)
      }
    } catch (e: Exception) {
      // receiver already registered / context unavailable
    }
  }

  override fun invalidate() {
    try { ctx.unregisterReceiver(chatRx) } catch (e: Exception) {}
    super.invalidate()
  }

  /** Send a short offline chat message to nearby phones over Bluetooth. */
  @ReactMethod
  fun sendChat(text: String, sender: String, promise: Promise) {
    try {
      val intent = Intent(ctx, OrbiiMeshService::class.java).apply {
        action = OrbiiMeshService.ACTION_CHAT
        putExtra(OrbiiMeshService.EXTRA_CHAT_TEXT, text)
        putExtra(OrbiiMeshService.EXTRA_CHAT_SENDER, sender)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent)
      else ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("mesh_chat_failed", e)
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

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
