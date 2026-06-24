package com.orbii.app.voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import java.io.File
import java.io.FileOutputStream
import kotlin.concurrent.thread

/**
 * Voice SOS — a microphone foreground service that runs on-device speech
 * recognition (Vosk) and fires an SOS when it hears the user's secret phrase.
 *
 * Fully offline & API-free:
 *   • The speech models (English + Hindi) are BUNDLED in the APK under
 *     assets/vosk-model-en and assets/vosk-model-hi. Nothing is ever
 *     downloaded; no audio ever leaves the phone; no API keys.
 *   • On first run we copy the bundled models from assets into the app's
 *     private storage once (Vosk needs a real filesystem path), then load
 *     both so English ("help", "save me") and Hindi ("बचाओ", "मदद") trigger.
 *
 * Battery: a cheap RMS energy gate (VAD) only feeds audio to the recognizers
 * when there is actual sound, so silence costs almost nothing. The service
 * also auto-stops after the user-chosen duration.
 */
class VoiceGuardService : Service() {

  companion object {
    const val EXTRA_PHRASES = "phrases"          // newline-separated
    const val EXTRA_DURATION_MS = "durationMs"   // 0 = until stopped
    private const val TAG = "VoiceGuard"
    private const val ONGOING_ID = 4101
    private const val ALERT_ID = 4102
    private const val CH_ONGOING = "orbii-protection"
    private const val CH_ALERT = "orbii-voice-alert"
    private const val SAMPLE_RATE = 16000
    // English ships INSIDE the apk (assets/vosk-model-en, copied to filesDir
    // once). Hindi is an optional on-demand download that lands directly in
    // filesDir/vosk-model-hi — loaded only when present, so English-only users
    // never allocate a second recognizer.
    private const val MODEL_EN = "vosk-model-en"
    private const val MODEL_HI = "vosk-model-hi"
    // RMS threshold below which we treat the frame as silence (skip ASR).
    private const val VAD_RMS = 550.0

    // Always-on panic words, matched on top of the user's custom phrases.
    // English is matched against the en model's Latin output; Hindi is matched
    // against the hi model's Devanagari output.
    private val BUILT_IN = listOf(
      // English
      "help", "help me", "save me", "bachao", "madad",
      // Hindi (Devanagari — what the Hindi model actually emits)
      "बचाओ", "मदद", "मदद करो", "बचाओ बचाओ", "मुझे बचाओ", "कोई बचाओ",
    )
  }

  @Volatile private var running = false
  private var phrases: List<String> = emptyList()
  private var wakeLock: PowerManager.WakeLock? = null
  private val main = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Persist phrases + duration so a START_STICKY restart (null intent, after
    // the OS kills us) keeps listening for the SAME custom phrases.
    val prefs = getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
    val raw = intent?.getStringExtra(EXTRA_PHRASES)
    if (raw != null) prefs.edit().putString("phrases", raw).apply()
    val source = raw ?: prefs.getString("phrases", "") ?: ""
    val custom = source.split("\n").map { it.trim().lowercase() }.filter { it.length >= 3 }
    phrases = (custom + BUILT_IN).distinct()
    val durationMs = if (intent != null && intent.hasExtra(EXTRA_DURATION_MS)) {
      val d = intent.getLongExtra(EXTRA_DURATION_MS, 0L)
      prefs.edit().putLong("duration", d).apply()
      d
    } else {
      prefs.getLong("duration", 0L)
    }

    startForegroundCompat()
    acquireWakeLock(durationMs)

    if (!running) {
      running = true
      thread(name = "voice-guard") { listenLoop() }
    }
    if (durationMs > 0L) {
      main.postDelayed({ stopSelf() }, durationMs)
    }
    return START_STICKY
  }

  // ── recognition loop ──────────────────────────────────────
  private fun listenLoop() {
    // Build the model set: English always (bundled), Hindi only if the user
    // downloaded the optional pack. Each model gets its own recognizer and we
    // feed the same audio to all of them, so a phrase in either language
    // triggers. English-only users load a single recognizer = less RAM/CPU.
    val modelDirs = ArrayList<File>()
    try {
      modelDirs.add(ensureBundledModel(MODEL_EN))
    } catch (e: Exception) {
      Log.e(TAG, "english model unpack failed", e)
    }
    val hiDir = File(filesDir, MODEL_HI)
    if (File(hiDir, "conf").exists()) modelDirs.add(hiDir)

    val models = ArrayList<Model>()
    val recognizers = ArrayList<Recognizer>()
    for (dir in modelDirs) {
      try {
        val m = Model(dir.absolutePath)
        models.add(m)
        recognizers.add(Recognizer(m, SAMPLE_RATE.toFloat()))
      } catch (e: Exception) {
        Log.e(TAG, "model load failed: ${dir.name}", e)
      }
    }
    if (recognizers.isEmpty()) {
      notifyProtectionError()
      stopSelf()
      return
    }

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufSize = maxOf(minBuf, SAMPLE_RATE) // ~1s
    val record = try {
      AudioRecord(
        MediaRecorder.AudioSource.VOICE_RECOGNITION,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize,
      )
    } catch (e: SecurityException) {
      Log.e(TAG, "mic permission missing", e)
      recognizers.forEach { it.close() }
      models.forEach { it.close() }
      stopSelf()
      return
    }

    val buffer = ShortArray(bufSize / 2)
    try {
      record.startRecording()
      while (running) {
        val n = record.read(buffer, 0, buffer.size)
        if (n <= 0) continue
        if (rms(buffer, n) < VAD_RMS) continue // VAD: skip silence
        for (rec in recognizers) {
          if (rec.acceptWaveForm(buffer, n)) {
            handleText(JSONObject(rec.result).optString("text"))
          } else {
            handleText(JSONObject(rec.partialResult).optString("partial"))
          }
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "listen loop error", e)
    } finally {
      try { record.stop() } catch (_: Exception) {}
      record.release()
      recognizers.forEach { it.close() }
      models.forEach { it.close() }
    }
  }

  private fun rms(buf: ShortArray, n: Int): Double {
    var sum = 0.0
    for (i in 0 until n) sum += buf[i].toDouble() * buf[i].toDouble()
    return Math.sqrt(sum / n)
  }

  @Volatile private var lastFire = 0L
  private fun handleText(text: String?) {
    if (text.isNullOrBlank()) return
    val t = text.lowercase()
    if (phrases.none { t.contains(it) }) return
    val now = System.currentTimeMillis()
    if (now - lastFire < 8000) return // debounce
    lastFire = now
    fireSos()
  }

  // ── trigger SOS via a full-screen-intent notification ─────
  private fun fireSos() {
    val deepLink = Intent(Intent.ACTION_VIEW, Uri.parse("orbii://voice-sos")).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
    val pi = PendingIntent.getActivity(
      this, 0, deepLink,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = Notification.Builder(this, CH_ALERT)
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName))
      .setContentTitle("ORBII SOS")
      .setContentText("Voice trigger heard — tap to open emergency")
      .setPriority(Notification.PRIORITY_MAX)
      .setCategory(Notification.CATEGORY_ALARM)
      .setFullScreenIntent(pi, true)
      // Android 14+ demotes full-screen intents for non-calling apps, so we
      // ALSO set a content intent — that keeps the notification tappable so
      // the SOS screen still opens when the user taps it.
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build()
    nm().notify(ALERT_ID, n)
    // also try to launch directly
    try { startActivity(deepLink) } catch (_: Exception) {}
  }

  // Surface a tappable notification if voice protection can't start (e.g. the
  // bundled model couldn't be unpacked — extremely rare, e.g. no free storage).
  private fun notifyProtectionError() {
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pi = PendingIntent.getActivity(
      this, 2, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = Notification.Builder(this, CH_ALERT)
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName))
      .setContentTitle("Voice protection couldn't start")
      .setContentText("Free up a little storage and reopen ORBII to enable Voice SOS.")
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build()
    nm().notify(ALERT_ID + 1, n)
  }

  // ── model management (copy bundled model from assets, once) ─
  private fun ensureBundledModel(name: String): File {
    val dir = File(filesDir, name)
    // Vosk model folders contain a "conf" subdir when fully unpacked.
    if (File(dir, "conf").exists()) return dir
    dir.deleteRecursively()
    dir.mkdirs()
    Log.i(TAG, "unpacking bundled model $name…")
    copyAsset(name, dir)
    return dir
  }

  // Recursively copy an assets/ subtree to a real directory. AssetManager.list
  // returns child names for a folder and an empty array for a file.
  private fun copyAsset(assetPath: String, outFile: File) {
    val children = assets.list(assetPath)
    if (children.isNullOrEmpty()) {
      // Leaf → it's a file. Stream it out.
      outFile.parentFile?.mkdirs()
      assets.open(assetPath).use { input ->
        FileOutputStream(outFile).use { out -> input.copyTo(out, 1 shl 16) }
      }
      return
    }
    outFile.mkdirs()
    for (child in children) {
      copyAsset("$assetPath/$child", File(outFile, child))
    }
  }

  // ── foreground notification plumbing ──────────────────────
  private fun startForegroundCompat() {
    ensureChannels()
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pi = PendingIntent.getActivity(
      this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = Notification.Builder(this, CH_ONGOING)
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName))
      .setContentTitle("ORBII is protecting you")
      .setContentText("Listening for your safety phrase")
      .setOngoing(true)
      .setContentIntent(pi)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(ONGOING_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(ONGOING_ID, n)
    }
  }

  private fun ensureChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = nm()
    mgr.createNotificationChannel(
      NotificationChannel(CH_ONGOING, "Protection", NotificationManager.IMPORTANCE_LOW),
    )
    mgr.createNotificationChannel(
      NotificationChannel(CH_ALERT, "Voice SOS", NotificationManager.IMPORTANCE_HIGH),
    )
  }

  private fun nm() = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun acquireWakeLock(durationMs: Long) {
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "orbii:voiceguard").apply {
      val timeout = if (durationMs in 1..86_400_000) durationMs else 12 * 60 * 60 * 1000L
      acquire(timeout)
    }
  }

  override fun onDestroy() {
    running = false
    try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    super.onDestroy()
  }
}
