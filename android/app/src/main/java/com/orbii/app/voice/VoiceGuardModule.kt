package com.orbii.app.voice

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
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

  /**
   * Whisper mode lowers the silence gate so a whispered plea still reaches the
   * recognizers. Persisted by the service; takes effect on the next startGuard,
   * which savePhrases()/applyPhrases() already re-issues.
   */
  @ReactMethod
  fun setWhisperMode(enabled: Boolean, promise: Promise) {
    try {
      ctx.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
        .edit().putBoolean("whisper", enabled).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("whisper_failed", e)
    }
  }

  @ReactMethod
  fun stopGuard(promise: Promise) {
    try {
      // Clear the "enabled" gate FIRST, so an OEM auto-restart (START_STICKY,
      // null intent) sees the guard is off and stops itself instead of quietly
      // turning the mic back on. This is the core of the "still listening after
      // I turned it off" fix.
      ctx.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
        .edit().putBoolean("enabled", false).apply()
      ctx.stopService(Intent(ctx, VoiceGuardService::class.java))
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("stop_failed", e)
    }
  }

  // Dismiss the "ORBII SOS" alert notification that fireSos() posts. Used by the
  // Voice SOS self-test / onboarding demo: the test consumes the deep-link fire,
  // but the notification would linger and re-open the REAL countdown when it
  // auto-launches or is tapped. Cancelling it here closes that double-fire hole.
  @ReactMethod
  fun cancelSosAlert(promise: Promise) {
    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE)
        as android.app.NotificationManager
      nm.cancel(4102) // VoiceGuardService.ALERT_ID
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // Remember whether to re-arm background voice after a reboot. Read by
  // BootReceiver on BOOT_COMPLETED. Set true when background protection is
  // armed, false when the user turns it off (so foreground-only listening
  // never survives a reboot).
  @ReactMethod
  fun setBootRestore(enabled: Boolean, promise: Promise) {
    try {
      ctx.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
        .edit().putBoolean("bootRestore", enabled).apply()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
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

  // Liveness beacon written by VoiceGuardService's listen loop (epoch ms). 0 =
  // never started. The app compares this against "now" on foreground to tell if
  // an aggressive OEM battery manager silently killed the listener.
  @ReactMethod
  fun getLastHeartbeat(promise: Promise) {
    try {
      val ts = ctx.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
        .getLong("heartbeat", 0L)
      promise.resolve(ts.toDouble())
    } catch (e: Exception) {
      promise.resolve(0.0)
    }
  }

  // Open ORBII's own App info page — the reliable, always-present home for
  // per-app battery + background settings on every OEM.
  @ReactMethod
  fun openAppSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${ctx.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  // Try to open the OEM's Autostart / Auto-launch manager (the setting that most
  // often decides whether a background service survives on Xiaomi/Oppo/Vivo/
  // etc.). Component names vary wildly by skin and version, so we probe a list
  // for the current manufacturer and fall back to App info if none resolves.
  @ReactMethod
  fun openAutoStartSettings(promise: Promise) {
    for (c in autoStartComponents()) {
      try {
        val intent = Intent().apply {
          component = c
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        if (ctx.packageManager.resolveActivity(intent, 0) != null) {
          ctx.startActivity(intent)
          promise.resolve(true)
          return
        }
      } catch (_: Exception) {
        // try the next candidate
      }
    }
    // Nothing matched — App info is always there and holds the same controls.
    try {
      val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.parse("package:${ctx.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    } catch (_: Exception) {
      // give up quietly
    }
    promise.resolve(false)
  }

  private fun autoStartComponents(): List<ComponentName> {
    val m = Build.MANUFACTURER.lowercase()
    val list = mutableListOf<ComponentName>()
    fun add(pkg: String, cls: String) = list.add(ComponentName(pkg, cls))
    when {
      m.contains("xiaomi") || m.contains("redmi") || m.contains("poco") ->
        add("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")
      m.contains("oppo") || m.contains("realme") -> {
        add("com.coloros.safecenter", "com.coloros.safecenter.permission.startup.StartupAppListActivity")
        add("com.coloros.safecenter", "com.coloros.safecenter.startupapp.StartupAppListActivity")
        add("com.oppo.safe", "com.oppo.safe.permission.startup.StartupAppListActivity")
      }
      m.contains("vivo") || m.contains("iqoo") -> {
        add("com.vivo.permissionmanager", "com.vivo.permissionmanager.activity.BgStartUpManagerActivity")
        add("com.iqoo.secure", "com.iqoo.secure.ui.phoneoptimize.AddWhiteListActivity")
      }
      m.contains("oneplus") ->
        add("com.oneplus.security", "com.oneplus.security.chainlaunch.view.ChainLaunchAppListActivity")
      m.contains("huawei") || m.contains("honor") -> {
        add("com.huawei.systemmanager", "com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity")
        add("com.huawei.systemmanager", "com.huawei.systemmanager.optimize.process.ProtectActivity")
      }
      m.contains("samsung") ->
        add("com.samsung.android.lool", "com.samsung.android.sm.ui.battery.BatteryActivity")
    }
    return list
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

  // ── live recognition metrics (debug / tuning screen) ──────
  @ReactMethod
  fun getVoiceMetrics(promise: Promise) {
    val m = Arguments.createMap()
    m.putBoolean("running", VoiceMetrics.running)
    m.putBoolean("grammarMode", VoiceMetrics.grammarMode)
    m.putDouble("rms", VoiceMetrics.rms)
    m.putBoolean("vadActive", VoiceMetrics.vadActive)
    m.putDouble("vadThreshold", VoiceMetrics.vadThreshold)
    m.putDouble("gain", VoiceMetrics.gain)
    m.putString("lastText", VoiceMetrics.lastText)
    m.putDouble("lastConfidence", VoiceMetrics.lastConfidence)
    m.putString("lastTriggerPhrase", VoiceMetrics.lastTriggerPhrase)
    m.putDouble("lastTriggerAtMs", VoiceMetrics.lastTriggerAtMs.toDouble())
    m.putDouble("lastLatencyMs", VoiceMetrics.lastLatencyMs.toDouble())
    m.putInt("triggerCount", VoiceMetrics.triggerCount)
    val avg = if (VoiceMetrics.triggerCount > 0)
      VoiceMetrics.totalLatencyMs.toDouble() / VoiceMetrics.triggerCount else 0.0
    m.putDouble("avgLatencyMs", avg)
    promise.resolve(m)
  }

  @ReactMethod
  fun resetVoiceMetrics(promise: Promise) {
    VoiceMetrics.reset()
    promise.resolve(true)
  }

  // NativeEventEmitter compatibility no-ops.
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
