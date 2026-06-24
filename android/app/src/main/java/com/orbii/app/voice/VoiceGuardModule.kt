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
import java.io.File

/** JS bridge for the background Voice SOS foreground service. */
class VoiceGuardModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  companion object {
    // Optional Hindi language pack (not bundled — fetched on demand so the
    // base APK stays small). Source: Vosk's official small Hindi model.
    private const val HINDI_URL =
      "https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip"
    private const val HINDI_DIR = "vosk-model-hi"
  }

  // 0..100 while a language pack downloads; -1 on failure. Polled from JS so we
  // don't depend on the event emitter (which differs across RN architectures).
  @Volatile private var dlProgress = 0

  override fun getName() = "VoiceGuard"

  // ── optional Hindi language pack ──────────────────────────
  @ReactMethod
  fun isHindiModelReady(promise: Promise) {
    promise.resolve(File(File(ctx.filesDir, HINDI_DIR), "conf").exists())
  }

  @ReactMethod
  fun getModelDownloadProgress(promise: Promise) {
    promise.resolve(dlProgress.toDouble())
  }

  @ReactMethod
  fun downloadHindiModel(promise: Promise) {
    if (File(File(ctx.filesDir, HINDI_DIR), "conf").exists()) {
      dlProgress = 100
      promise.resolve(true)
      return
    }
    dlProgress = 0
    Thread {
      try {
        VoiceModelDownloader.download(ctx, HINDI_URL, HINDI_DIR) { p -> dlProgress = p }
        dlProgress = 100
        promise.resolve(true)
      } catch (e: Exception) {
        dlProgress = -1
        promise.reject("download_failed", e)
      }
    }.start()
  }

  @ReactMethod
  fun deleteHindiModel(promise: Promise) {
    try {
      File(ctx.filesDir, HINDI_DIR).deleteRecursively()
      dlProgress = 0
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("delete_failed", e)
    }
  }

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

  // ── full-screen-intent access (Android 14+) ───────────────
  // On Android 14+ the OS revokes USE_FULL_SCREEN_INTENT from non-calling apps
  // by default, which DEMOTES our SOS full-screen intent to a silent
  // notification — so the countdown screen never appears over the lock screen.
  // These let JS check + send the user to grant it.
  @ReactMethod
  fun canUseFullScreenIntent(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
          as android.app.NotificationManager
        promise.resolve(nm.canUseFullScreenIntent())
      } else {
        promise.resolve(true) // granted by default below 14
      }
    } catch (e: Exception) {
      promise.resolve(true)
    }
  }

  @ReactMethod
  fun requestFullScreenIntentPermission(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= 34) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT).apply {
          data = Uri.parse("package:${ctx.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        ctx.startActivity(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // NativeEventEmitter compatibility no-ops.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
