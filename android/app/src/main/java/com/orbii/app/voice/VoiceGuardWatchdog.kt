package com.orbii.app.voice

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Restarts Voice SOS when an OEM has killed it.
 *
 * WHAT THIS IS FOR. START_STICKY already handles the ordinary case: Android
 * kills the service for memory and hands it back a null intent, and the hard-off
 * gate in onStartCommand decides whether to resurrect. What START_STICKY does
 * NOT survive is an aggressive task manager. MIUI, ColorOS and FuntouchOS will
 * force-stop the whole app from their own cleanup UI or on a swipe from
 * recents, and a force-stopped app receives nothing: no restart, no broadcast,
 * no callback. The service simply stops existing and the user is told nothing.
 *
 * So something outside the process has to notice. WorkManager survives
 * force-stop, because the OS reschedules from its own database, and it is
 * already on the classpath transitively (androidx.work 2.9.1) so this costs
 * no APK size.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE LIMIT, STATED UP FRONT: this cannot deliver 99.9% uptime, and no
 * architecture on modern Android can.
 *
 * Since Android 12, an app may not start a foreground service from the
 * background. startForegroundService() from here throws
 * ForegroundServiceStartNotAllowedException unless the app holds an exemption,
 * and the practical exemption is battery-optimisation ignore, which only the
 * user can grant. So the honest chain is:
 *
 *   user grants battery exemption  →  watchdog can restart  →  high uptime
 *   user does not                  →  watchdog can only NOTIFY  →  she must tap
 *
 * That is why OemSettingsModule exists and why the setup checklist matters.
 * The exemption is not a nice-to-have that improves reliability; it is the
 * thing that makes automated recovery legal. Anyone quoting an uptime figure
 * for this app has to quote it conditional on that permission.
 *
 * The fallback is deliberately a notification rather than silence. A user whose
 * protection stopped four hours ago and does not know is in a worse position
 * than one who was never protected, because she is relying on it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
class VoiceGuardWatchdog(
  appContext: Context,
  params: WorkerParameters,
) : Worker(appContext, params) {

  companion object {
    private const val TAG = "VoiceGuardWatchdog"
    private const val WORK_NAME = "orbii-voiceguard-watchdog"

    /**
     * WorkManager's floor for periodic work is 15 minutes and it is not
     * negotiable. Worst case, protection is down for a quarter of an hour
     * before this notices. That is poor, and it is still far better than the
     * current behaviour, which is down until the user happens to open the app.
     */
    private const val INTERVAL_MIN = 15L

    /**
     * The service stamps a heartbeat every ~30 s. Three missed stamps means it
     * is genuinely gone rather than briefly descheduled. Deliberately generous:
     * a false positive here restarts a service that is already running, which
     * is wasteful, and a false negative leaves someone unprotected.
     */
    private const val STALE_MS = 100_000L

    /** Start the watchdog. Idempotent, safe to call on every app launch. */
    @JvmStatic
    fun ensureScheduled(ctx: Context) {
      try {
        val req = PeriodicWorkRequestBuilder<VoiceGuardWatchdog>(
          INTERVAL_MIN, TimeUnit.MINUTES,
        )
          // No network or charging constraint on purpose. This check needs
          // nothing, and every constraint is another reason the OS defers it.
          .setConstraints(Constraints.NONE)
          .addTag(WORK_NAME)
          .build()

        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
          WORK_NAME,
          // KEEP, not UPDATE: re-enqueueing on every launch with UPDATE resets
          // the period, so a user who opens the app often would push the check
          // back forever and it would never actually run.
          ExistingPeriodicWorkPolicy.KEEP,
          req,
        )
      } catch (e: Exception) {
        Log.w(TAG, "could not schedule watchdog", e)
      }
    }

    /** Stop watching. Called when the user turns Voice SOS off. */
    @JvmStatic
    fun cancel(ctx: Context) {
      try {
        WorkManager.getInstance(ctx).cancelUniqueWork(WORK_NAME)
      } catch (e: Exception) {
        Log.w(TAG, "could not cancel watchdog", e)
      }
    }
  }

  override fun doWork(): Result {
    val ctx = applicationContext
    val prefs = ctx.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)

    // 1. Is Voice SOS supposed to be on at all?
    //
    // The same flag onStartCommand's hard-off gate reads. If the user turned it
    // off, this must never bring the microphone back. A watchdog that resurrects
    // a service the user switched off is a bug with the worst possible optics
    // on a product whose entire pitch is that it does not listen to you.
    if (!prefs.getBoolean("enabled", false)) {
      cancel(ctx)
      return Result.success()
    }

    // 2. Has the armed window expired? duration 0 means "until stopped".
    val duration = prefs.getLong("duration", 0L)
    val armedAt = prefs.getLong("armed_at", 0L)
    if (duration > 0 && armedAt > 0 && System.currentTimeMillis() > armedAt + duration) {
      prefs.edit().putBoolean("enabled", false).apply()
      cancel(ctx)
      return Result.success()
    }

    // 3. Is it actually running? Two independent checks, because either alone
    //    lies. The heartbeat can be stale on a device that just woke from deep
    //    doze; the service list can be empty while the process is alive.
    val heartbeat = prefs.getLong("heartbeat", 0L)
    val stale = System.currentTimeMillis() - heartbeat > STALE_MS
    if (!stale && isServiceRunning(ctx)) return Result.success()

    Log.w(TAG, "voice guard looks dead (stale=$stale), attempting restart")
    return if (restart(ctx)) Result.success() else Result.retry()
  }

  /**
   * Deprecated since API 26 for other apps' services, but still accurate for
   * your OWN, which is the only thing asked here. Kept as a second opinion
   * alongside the heartbeat rather than as the primary signal.
   */
  @Suppress("DEPRECATION")
  private fun isServiceRunning(ctx: Context): Boolean {
    return try {
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      am.getRunningServices(Int.MAX_VALUE).any {
        it.service.className == VoiceGuardService::class.java.name
      }
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Try to bring the service back. Returns whether the OS let us.
   *
   * The null-intent restart path is deliberate: it takes exactly the same route
   * as a START_STICKY resurrection, so the hard-off gate and the persisted
   * phrases and whisper mode all apply unchanged. There is one place that
   * decides whether listening is allowed, and it is not this file.
   */
  private fun restart(ctx: Context): Boolean {
    return try {
      val intent = Intent(ctx, VoiceGuardService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      Log.i(TAG, "voice guard restarted by watchdog")
      true
    } catch (e: Exception) {
      // On Android 12+ this is ForegroundServiceStartNotAllowedException when
      // the app has no battery exemption. It is not an error in our code, it is
      // the OS declining, and the only remaining move is to tell the user.
      Log.w(TAG, "restart refused by OS, notifying instead", e)
      notifyUserProtectionStopped(ctx)
      false
    }
  }

  /**
   * Last resort: tell her the protection is off.
   *
   * Silence here is the failure mode that actually hurts. Somebody who believes
   * Voice SOS is listening and walks home accordingly is worse off than
   * somebody who knows it stopped, because she has adjusted her behaviour
   * around a guarantee that no longer holds.
   */
  private fun notifyUserProtectionStopped(ctx: Context) {
    try {
      val exempt = try {
        val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
        pm.isIgnoringBatteryOptimizations(ctx.packageName)
      } catch (e: Exception) {
        false
      }
      VoiceGuardNotifications.protectionStopped(ctx, batteryExempt = exempt)
    } catch (e: Exception) {
      Log.w(TAG, "could not notify", e)
    }
  }
}
