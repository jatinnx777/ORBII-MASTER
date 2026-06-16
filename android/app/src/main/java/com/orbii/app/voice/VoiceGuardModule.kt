package com.orbii.app.voice

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/** JS bridge for the background Voice SOS foreground service. */
class VoiceGuardModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "VoiceGuard"

  @ReactMethod
  fun startGuard(phrases: ReadableArray, durationMs: Double, promise: Promise) {
    try {
      val list = ArrayList<String>()
      for (i in 0 until phrases.size()) phrases.getString(i)?.let { list.add(it) }
      val intent = Intent(ctx, VoiceGuardService::class.java).apply {
        putExtra(VoiceGuardService.EXTRA_PHRASES, list.joinToString("\n"))
        putExtra(VoiceGuardService.EXTRA_DURATION_MS, durationMs.toLong())
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("start_failed", e)
    }
  }

  @ReactMethod
  fun stopGuard(promise: Promise) {
    try {
      ctx.stopService(Intent(ctx, VoiceGuardService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("stop_failed", e)
    }
  }

  @ReactMethod
  fun isIgnoringBatteryOptimization(promise: Promise) {
    try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      promise.resolve(pm.isIgnoringBatteryOptimizations(ctx.packageName))
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun requestDisableBatteryOptimization(promise: Promise) {
    try {
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      if (pm.isIgnoringBatteryOptimizations(ctx.packageName)) {
        promise.resolve(true)
        return
      }
      val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = Uri.parse("package:${ctx.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
      promise.resolve(false)
    } catch (e: Exception) {
      promise.reject("battery_opt_failed", e)
    }
  }

  // NativeEventEmitter compatibility no-ops.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
