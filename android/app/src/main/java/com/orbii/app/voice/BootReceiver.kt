package com.orbii.app.voice

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Re-arm background Voice SOS after a reboot, so the user isn't silently left
 * unprotected once the phone restarts.
 *
 * Only restarts if the user actually had background protection ON (the
 * `bootRestore` flag, written when they armed it). Best-effort: Android 14+ can
 * block starting a microphone foreground service from the background — in that
 * case the app re-arms on next foreground (App.tsx) and the protection-status
 * indicator shows protection is paused, so the user is never falsely reassured.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON" &&
      action != "com.htc.intent.action.QUICKBOOT_POWERON"
    ) {
      return
    }
    val prefs = context.getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
    if (!prefs.getBoolean("bootRestore", false)) return
    try {
      val svc = Intent(context, VoiceGuardService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(svc)
      } else {
        context.startService(svc)
      }
      Log.i("VoiceGuard", "boot restore: voice protection restarted")
    } catch (e: Exception) {
      Log.w("VoiceGuard", "boot restore blocked — will re-arm on app open", e)
    }
  }
}
