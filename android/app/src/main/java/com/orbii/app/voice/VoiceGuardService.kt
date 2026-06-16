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
import java.net.URL
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/**
 * Background Voice SOS. A microphone foreground service that runs on-device
 * speech recognition (Vosk) and fires an SOS when it hears the user's secret
 * phrase. No audio ever leaves the phone; no API keys.
 *
 * Battery: a cheap RMS energy gate (VAD) only feeds audio to the recognizer
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
    private const val MODEL_URL = "https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip"
    private const val MODEL_DIR = "vosk-model-en"
    // RMS threshold below which we treat the frame as silence (skip ASR).
    private const val VAD_RMS = 550.0

    // Always-on panic words, matched on top of the user's custom phrases.
    private val BUILT_IN = listOf("help", "help me", "save me", "bachao", "madad")
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
    val model = try {
      Model(ensureModel().absolutePath)
    } catch (e: Exception) {
      Log.e(TAG, "model load failed", e)
      stopSelf()
      return
    }

    val recognizer = Recognizer(model, SAMPLE_RATE.toFloat())
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
        if (recognizer.acceptWaveForm(buffer, n)) {
          handleText(JSONObject(recognizer.result).optString("text"))
        } else {
          handleText(JSONObject(recognizer.partialResult).optString("partial"))
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "listen loop error", e)
    } finally {
      try { record.stop() } catch (_: Exception) {}
      record.release()
      recognizer.close()
      model.close()
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
      .setContentText("Voice trigger heard — opening emergency")
      .setPriority(Notification.PRIORITY_MAX)
      .setCategory(Notification.CATEGORY_ALARM)
      .setFullScreenIntent(pi, true)
      .setAutoCancel(true)
      .build()
    nm().notify(ALERT_ID, n)
    // also try to launch directly
    try { startActivity(deepLink) } catch (_: Exception) {}
  }

  // ── model management (download + unzip once) ──────────────
  private fun ensureModel(): File {
    val dir = File(filesDir, MODEL_DIR)
    // Vosk model folders contain a "conf" subdir when fully unpacked.
    if (File(dir, "conf").exists()) return dir
    dir.deleteRecursively()
    dir.mkdirs()
    Log.i(TAG, "downloading vosk model…")
    val tmp = File(cacheDir, "vosk.zip")
    URL(MODEL_URL).openStream().use { input ->
      FileOutputStream(tmp).use { out -> input.copyTo(out, 1 shl 16) }
    }
    ZipInputStream(tmp.inputStream()).use { zip ->
      var entry = zip.nextEntry
      while (entry != null) {
        // strip the top-level folder name from the zip
        val rel = entry.name.substringAfter('/')
        if (rel.isNotEmpty()) {
          val outFile = File(dir, rel)
          if (entry.isDirectory) {
            outFile.mkdirs()
          } else {
            outFile.parentFile?.mkdirs()
            FileOutputStream(outFile).use { fos -> zip.copyTo(fos, 1 shl 16) }
          }
        }
        entry = zip.nextEntry
      }
    }
    tmp.delete()
    return dir
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
