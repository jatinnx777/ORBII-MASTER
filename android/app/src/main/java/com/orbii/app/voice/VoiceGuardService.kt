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
    // Lowered for higher recall — quieter / first-time utterances used to be
    // gated out, so the user had to repeat the phrase. 200 still skips true
    // silence (which reads ~0–80) while letting soft speech through.
    private const val VAD_RMS = 200.0

    // Smart auto-gain: lift quiet/muffled speech (pocket, purse) toward a
    // target loudness before the recognizer sees it, with a hard ceiling so we
    // never blow up background noise or clip badly.
    private const val TARGET_RMS = 3000.0
    private const val MAX_GAIN = 6.0 // ~ +15.5 dB

    // Emergency phrases, matched whole-word in maybeTrigger. Bare "help" is
    // deliberately NOT here — it's too common in normal conversation. Instead
    // "help help" (said twice, which people do naturally when panicking) is the
    // trigger, alongside the other deliberate plea phrases. English runs on the
    // bundled model; Devanagari runs on the optional Hindi pack.
    private val EN_PHRASES = listOf(
      "help help", "help me", "save me", "emergency", "i need help",
    )
    private val HI_PHRASES_DEVA = listOf(
      "बचाओ बचाओ", "बचाओ मुझे", "मदद करो", "मुझे बचाओ", "बचाइये",
    )
    // Romanised Hindi is kept ONLY for substring matching of free-form output
    // (e.g. a custom-phrase fallback recognizer) — the Hindi model itself emits
    // Devanagari.
    private val HI_PHRASES_ROMAN = listOf(
      "bachao bachao", "bachao mujhe", "madad karo", "mujhe bachao", "bachaiye",
    )
    private val BUILT_IN = EN_PHRASES + HI_PHRASES_DEVA + HI_PHRASES_ROMAN
  }

  @Volatile private var running = false
  private var phrases: List<String> = emptyList()
  @Volatile private var smoothedGain = 1.0
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
    val models = ArrayList<Model>()
    val recognizers = ArrayList<Recognizer>()
    VoiceMetrics.grammarMode = false

    // English (bundled). Free-form recognition + STRICT whole-word matching
    // (see maybeTrigger) so only the real trigger words fire.
    try {
      val enModel = Model(ensureBundledModel(MODEL_EN).absolutePath)
      models.add(enModel)
      recognizers.add(makeRecognizer(enModel))
    } catch (e: Exception) {
      Log.e(TAG, "english model load failed", e)
    }

    // Hindi (optional pack).
    val hiDir = File(filesDir, MODEL_HI)
    if (File(hiDir, "conf").exists()) {
      try {
        val hiModel = Model(hiDir.absolutePath)
        models.add(hiModel)
        recognizers.add(makeRecognizer(hiModel))
      } catch (e: Exception) {
        Log.e(TAG, "hindi model load failed", e)
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
    VoiceMetrics.running = true
    VoiceMetrics.vadThreshold = VAD_RMS
    var speechStart = 0L
    try {
      record.startRecording()
      while (running) {
        val n = record.read(buffer, 0, buffer.size)
        if (n <= 0) continue
        val level = rms(buffer, n)
        VoiceMetrics.rms = level
        val active = level >= VAD_RMS
        VoiceMetrics.vadActive = active
        if (!active) {
          speechStart = 0L
          continue // VAD: skip silence (no ASR, no gain → battery stays low)
        }
        if (speechStart == 0L) speechStart = System.currentTimeMillis()
        applyGain(buffer, n, level)
        for (rec in recognizers) {
          if (rec.acceptWaveForm(buffer, n)) {
            val json = JSONObject(rec.result)
            updateConfidence(json)
            maybeTrigger(json.optString("text"), speechStart)
          } else {
            val partial = JSONObject(rec.partialResult).optString("partial")
            if (partial.isNotBlank()) VoiceMetrics.lastText = partial
            maybeTrigger(partial, speechStart)
          }
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "listen loop error", e)
    } finally {
      VoiceMetrics.running = false
      VoiceMetrics.vadActive = false
      try { record.stop() } catch (_: Exception) {}
      record.release()
      recognizers.forEach { it.close() }
      models.forEach { it.close() }
    }
  }

  // Free-form recognizer. We deliberately do NOT use Vosk grammar mode: a
  // grammar forces EVERY utterance onto the nearest trigger word, so random
  // speech ("hello", "yellow") got decoded as "help" and fired. Free-form
  // transcription + strict whole-word matching (maybeTrigger) means only the
  // actual trigger words fire.
  private fun makeRecognizer(model: Model): Recognizer {
    return Recognizer(model, SAMPLE_RATE.toFloat()).apply { setWords(true) }
  }

  private fun rms(buf: ShortArray, n: Int): Double {
    var sum = 0.0
    for (i in 0 until n) sum += buf[i].toDouble() * buf[i].toDouble()
    return Math.sqrt(sum / n)
  }

  // Smart auto-gain. Lift this frame toward TARGET_RMS (capped at MAX_GAIN),
  // smoothing the gain across frames so it doesn't "pump", and hard-clamping
  // samples so amplification can't clip into distortion. Only runs on frames
  // that already passed the VAD gate, so silence/noise isn't boosted.
  private fun applyGain(buf: ShortArray, n: Int, level: Double) {
    if (level < 1.0) return
    val desired = (TARGET_RMS / level).coerceIn(1.0, MAX_GAIN)
    smoothedGain += (desired - smoothedGain) * 0.25
    VoiceMetrics.gain = smoothedGain
    if (smoothedGain <= 1.02) return
    for (i in 0 until n) {
      val v = (buf[i] * smoothedGain).toInt()
      buf[i] = when {
        v > Short.MAX_VALUE -> Short.MAX_VALUE
        v < Short.MIN_VALUE -> Short.MIN_VALUE
        else -> v.toShort()
      }
    }
  }

  private fun updateConfidence(json: JSONObject) {
    val text = json.optString("text")
    if (text.isNotBlank()) VoiceMetrics.lastText = text
    val arr = json.optJSONArray("result") ?: return
    if (arr.length() == 0) return
    var sum = 0.0
    for (i in 0 until arr.length()) sum += arr.getJSONObject(i).optDouble("conf", 0.0)
    VoiceMetrics.lastConfidence = sum / arr.length()
  }

  @Volatile private var lastFire = 0L
  private fun maybeTrigger(text: String?, speechStart: Long) {
    if (text.isNullOrBlank()) return
    // STRICT whole-word / whole-phrase match. Pad with spaces so " help "
    // matches the word "help" but NOT "hello" / "helping" / "yellow". This is
    // what stops ordinary speech from firing an SOS.
    val t = " " + text.lowercase().trim().replace(Regex("\\s+"), " ") + " "
    val hit = phrases.firstOrNull { t.contains(" $it ") } ?: return
    val now = System.currentTimeMillis()
    if (now - lastFire < 6000) return // debounce
    lastFire = now
    VoiceMetrics.lastTriggerPhrase = hit
    VoiceMetrics.lastTriggerAtMs = now
    VoiceMetrics.triggerCount += 1
    if (speechStart > 0L) {
      val latency = now - speechStart
      VoiceMetrics.lastLatencyMs = latency
      VoiceMetrics.totalLatencyMs += latency
    }
    fireSos()
  }

  // Voice trigger → bring up the SOS countdown SCREEN over the lock screen, so
  // the user sees the real 5s countdown and can cancel WITHOUT unlocking. The
  // React CountdownScreen owns the timer + dispatch + the live ActiveSOS map;
  // this service's only job is to launch it reliably.
  //
  // Two paths for resilience: a full-screen-intent notification (the OS's
  // mechanism for showing UI over a locked screen) AND a direct startActivity
  // from this microphone foreground service (exempt from background-activity
  // limits while it runs). MainActivity is showWhenLocked + turnScreenOn, so
  // whichever lands wakes the screen and shows the countdown immediately.
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
      .setContentText("Opening emergency…")
      .setPriority(Notification.PRIORITY_MAX)
      .setCategory(Notification.CATEGORY_ALARM)
      .setFullScreenIntent(pi, true)
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build()
    nm().notify(ALERT_ID, n)
    try {
      startActivity(deepLink)
    } catch (e: Exception) {
      Log.e(TAG, "startActivity failed", e)
    }
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
    VoiceMetrics.running = false
    VoiceMetrics.vadActive = false
    try { wakeLock?.let { if (it.isHeld) it.release() } } catch (_: Exception) {}
    super.onDestroy()
  }
}

/**
 * Live recognition metrics, shared with the JS debug screen (read via
 * VoiceGuardModule.getVoiceMetrics). Plain volatile fields — written from the
 * audio thread, read from the bridge thread; we only need eventual-consistency
 * for a diagnostics view, so no locking.
 */
object VoiceMetrics {
  @Volatile var running = false
  @Volatile var grammarMode = false
  @Volatile var rms = 0.0
  @Volatile var vadActive = false
  @Volatile var vadThreshold = 200.0
  @Volatile var gain = 1.0
  @Volatile var lastText = ""
  @Volatile var lastConfidence = 0.0
  @Volatile var lastTriggerPhrase = ""
  @Volatile var lastTriggerAtMs = 0L
  @Volatile var lastLatencyMs = 0L
  @Volatile var triggerCount = 0
  @Volatile var totalLatencyMs = 0L

  fun reset() {
    triggerCount = 0
    totalLatencyMs = 0L
    lastLatencyMs = 0L
    lastTriggerPhrase = ""
    lastTriggerAtMs = 0L
    lastConfidence = 0.0
    lastText = ""
  }
}
