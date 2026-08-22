package com.orbii.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * The one notification the watchdog can raise, kept out of the service so it
 * can be posted from a Worker with no service running.
 */
object VoiceGuardNotifications {

  private const val CHANNEL = "orbii-protection-stopped"
  private const val ID = 4130

  /**
   * "Voice SOS stopped."
   *
   * Wording matters more than usual here. It has to be honest without being
   * frightening, name the actual cause, and give one action. It says the phone
   * stopped it, not that ORBII crashed, because that is both true and the thing
   * the user can do something about.
   *
   * HIGH importance and a full-screen-free, dismissible notification: this is
   * urgent information, but it is not itself an emergency, and treating it like
   * one would train people to swipe emergency-styled alerts away.
   */
  fun protectionStopped(ctx: Context, batteryExempt: Boolean) {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL, "Protection stopped", NotificationManager.IMPORTANCE_HIGH)
          .apply {
            description = "Tells you when your phone has stopped Voice SOS."
            enableVibration(true)
          },
      )
    }

    // Straight back into the app, which lands on the setup guide.
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.apply {
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      putExtra("orbii_route", "OEMHelp")
    }
    val pi = open?.let {
      PendingIntent.getActivity(
        ctx, 0, it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    }

    val body = if (batteryExempt) {
      // Exemption granted and it still died: this is an OEM task manager, and
      // the autostart list is the remaining lever.
      "Your phone stopped Voice SOS. Tap to allow it to run in the background, " +
        "or reopen ORBII to start listening again."
    } else {
      // The common case, and it has a specific fix.
      "Your phone's battery saver stopped Voice SOS. Tap to allow it to keep running."
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(ctx, CHANNEL)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(ctx)
    }

    val n = builder
      .setContentTitle("Voice SOS stopped")
      .setContentText(body)
      .setStyle(Notification.BigTextStyle().bigText(body))
      .setSmallIcon(android.R.drawable.ic_dialog_alert)
      .setAutoCancel(true)
      .apply { if (pi != null) setContentIntent(pi) }
      .build()

    nm.notify(ID, n)
  }

  /** Clear it once listening is confirmed back up. */
  fun clearProtectionStopped(ctx: Context) {
    try {
      (ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(ID)
    } catch (_: Exception) {
    }
  }
}
