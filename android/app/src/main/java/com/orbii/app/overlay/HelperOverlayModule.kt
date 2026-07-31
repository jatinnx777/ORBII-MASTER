package com.orbii.app.overlay

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

/**
 * "Display over other apps" SOS overlay for helpers.
 *
 * When a nearby person needs help and this helper is using another app, JS
 * calls showOverlay(). We add a WindowManager view of type
 * TYPE_APPLICATION_OVERLAY directly from the app process — no background service
 * (which Android 12+ blocks) — so it can pop over Instagram, reels, anything.
 * An alarm-channel siren (distinct from a notification sound) plays until the
 * helper taps "I'll help" (opens the app on this SOS) or "I'm busy" (dismiss).
 *
 * This works while the app's JS runtime is alive in the background. Reaching a
 * fully-killed app needs a high-priority FCM data push to wake it first — that
 * is the follow-up layer.
 */
class HelperOverlayModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  private var overlayView: View? = null
  private var player: MediaPlayer? = null

  override fun getName() = "HelperOverlay"

  private fun canDraw(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(ctx)

  @ReactMethod
  fun hasOverlayPermission(promise: Promise) {
    promise.resolve(canDraw())
  }

  @ReactMethod
  fun requestOverlayPermission(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(ctx)) {
        val intent = Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${ctx.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
      }
      promise.resolve(canDraw())
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  @ReactMethod
  fun showOverlay(data: ReadableMap, promise: Promise) {
    if (!canDraw()) {
      promise.resolve(false)
      return
    }
    val alertId = if (data.hasKey("alertId")) data.getString("alertId") ?: "" else ""
    val name = if (data.hasKey("name")) data.getString("name") ?: "Someone nearby" else "Someone nearby"
    val distance = if (data.hasKey("distance")) data.getString("distance") else null
    UiThreadUtil.runOnUiThread {
      try {
        addOverlay(alertId, name, distance)
      } catch (e: Exception) {
        // best effort
      }
    }
    promise.resolve(true)
  }

  @ReactMethod
  fun dismissOverlay(promise: Promise) {
    UiThreadUtil.runOnUiThread { removeOverlay() }
    promise.resolve(true)
  }

  private fun dp(px: Int): Int = (px * ctx.resources.displayMetrics.density).toInt()

  private fun addOverlay(alertId: String, name: String, distance: String?) {
    removeOverlay() // never stack two

    val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    val card = LinearLayout(ctx).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(22), dp(22), dp(22), dp(22))
      background = GradientDrawable().apply {
        cornerRadius = dp(24).toFloat()
        setColor(Color.parseColor("#17161C"))
      }
    }

    card.addView(TextView(ctx).apply {
      text = "$name needs help now"
      setTextColor(Color.WHITE)
      textSize = 20f
      setTypeface(typeface, Typeface.BOLD)
    })

    card.addView(TextView(ctx).apply {
      text = if (!distance.isNullOrBlank()) "$distance away. Can you get to them?"
             else "Someone close to you needs help now."
      setTextColor(Color.parseColor("#CFC9E8"))
      textSize = 14f
      setPadding(0, dp(6), 0, dp(16))
    })

    val row = LinearLayout(ctx).apply { orientation = LinearLayout.HORIZONTAL }
    val busy = Button(ctx).apply {
      text = "I'm busy"
      isAllCaps = false
      setTextColor(Color.parseColor("#CFC9E8"))
      background = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#2A2833"))
      }
      setOnClickListener { removeOverlay() }
    }
    val help = Button(ctx).apply {
      text = "I'll help"
      isAllCaps = false
      setTextColor(Color.WHITE)
      background = GradientDrawable().apply {
        cornerRadius = dp(14).toFloat(); setColor(Color.parseColor("#E24C4C"))
      }
      setOnClickListener {
        launchApp(alertId)
        removeOverlay()
      }
    }
    row.addView(busy, LinearLayout.LayoutParams(0, dp(52), 1f).apply { rightMargin = dp(8) })
    row.addView(help, LinearLayout.LayoutParams(0, dp(52), 1f).apply { leftMargin = dp(8) })
    card.addView(row)

    val container = LinearLayout(ctx).apply {
      setPadding(dp(14), 0, dp(14), 0)
      addView(
        card,
        LinearLayout.LayoutParams(
          LinearLayout.LayoutParams.MATCH_PARENT,
          LinearLayout.LayoutParams.WRAP_CONTENT,
        ),
      )
    }

    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
    else
      @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.MATCH_PARENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      type,
      // Not focusable (don't steal the keyboard) but still touchable so the two
      // buttons work. Show over the lock screen and wake the screen.
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP
      y = dp(72)
    }

    wm.addView(container, params)
    overlayView = container
    startSiren()
  }

  private fun launchApp(alertId: String) {
    try {
      val intent = Intent(
        Intent.ACTION_VIEW,
        Uri.parse("orbii://helper-respond?alertId=$alertId"),
      ).apply {
        setPackage(ctx.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    } catch (e: Exception) {
      // ignore
    }
  }

  private fun removeOverlay() {
    stopSiren()
    val v = overlayView ?: return
    overlayView = null
    try {
      val wm = ctx.getSystemService(Context.WINDOW_SERVICE) as WindowManager
      wm.removeView(v)
    } catch (e: Exception) {
      // already gone
    }
  }

  private fun startSiren() {
    try {
      var uri: Uri? = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      if (uri == null) uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
      if (uri == null) return
      player = MediaPlayer().apply {
        setDataSource(ctx, uri)
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        isLooping = true
        prepare()
        start()
      }
    } catch (e: Exception) {
      // sound is best-effort; the visual overlay + system vibration still fire
    }
  }

  private fun stopSiren() {
    try {
      player?.stop()
      player?.release()
    } catch (e: Exception) {
      // ignore
    }
    player = null
  }

  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Double) {}
}
