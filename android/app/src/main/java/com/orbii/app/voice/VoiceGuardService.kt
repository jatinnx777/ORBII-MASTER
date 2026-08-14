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

    // Read the mic in short frames, not one-second blocks. A shouted "help" is
    // ~300-400 ms; averaged across a whole second of buffer its energy fell
    // below the gate, so a muffled or far-away shout was thrown away as silence
    // and the user had to repeat it many times. 200 ms frames keep a short
    // shout's energy intact for the gate to see.
    private const val FRAME_SAMPLES = SAMPLE_RATE / 5 // 200 ms

    // Adaptive silence gate. A single fixed RMS threshold cannot work in both a
    // quiet bedroom and a noisy street: set it high enough to ignore a quiet
    // room's hum and it deafens the phone to muffled speech from a bag/pocket;
    // set it low and a noisy room feeds ASR constantly. Instead we TRACK the
    // ambient noise floor and require speech to stand a margin above it. This
    // is the main fix for "it only hears me with the phone at my mouth".
    private const val NOISE_MARGIN = 2.0    // speech must be this x the ambient floor
    private const val MIN_GATE = 85.0       // never demand less (a silent room still gates)
    private const val MAX_GATE = 450.0      // never demand more (so a loud room can't deafen us)
    // Self-healing: every frame the floor leaks a hair back toward MIN_GATE, so a
    // burst of noise — or muffled speech mistaken for noise — can never ratchet
    // the gate up and leave the phone progressively deafer over a long session.
    // This is the fix for "it catches fewer words the longer it runs".
    private const val FLOOR_LEAK = 0.0015

    // Whisper mode. A woman with an attacker beside her does not shout — she
    // whispers. Far more sensitive: a smaller margin and a lower floor. Opt-in,
    // because it feeds much more audio to ASR (battery).
    const val EXTRA_WHISPER = "whisper"
    private const val WHISPER_MARGIN = 1.5
    private const val WHISPER_MIN_GATE = 50.0

    // Pre-roll: keep the last N seconds of raw mic audio so the SOS clip starts
    // BEFORE she spoke. 15s @ 16k mono 16-bit ≈ 470 KB.
    private const val PREROLL_SECONDS = 15
    private const val PREROLL_DIR = "sos-preroll"

    // Fusion. These words are far too common to fire an SOS alone — but paired
    // with a weak distress sound (a scream YAMNet scored below its own firing
    // bar) they are strong evidence. This lets BOTH thresholds drop without
    // raising false positives, because neither signal is ever trusted alone.
    private val SOFT_WORDS = setOf(
      "help", "no", "stop", "please", "leave",
      "bachao", "madad", "chodo", "nahi", "mummy",
      "बचाओ", "मदद", "नहीं",
    )
    private const val FUSION_WINDOW_MS = 6000L

    // Smart auto-gain: lift quiet/muffled speech (pocket, purse) toward a
    // target loudness before the recognizer sees it, with a hard ceiling so we
    // never blow up background noise or clip badly. Raised to +21 dB: speech
    // through a bag or purse can be attenuated far more than +15 dB could
    // recover, and the recognizer needs it near TARGET_RMS to transcribe well.
    private const val TARGET_RMS = 3000.0
    private const val MAX_GAIN = 12.0 // ~ +21.5 dB

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

    // Keyword-grammar mode ("[unk]"-guarded) for MAXIMUM keyword accuracy.
    // Restricting a recognizer's vocabulary to just the distress words makes it
    // far more confident on a short, shouted "help"/"bachao"/"madad" than the
    // free-form model, which is the whole reason a single shout sometimes didn't
    // fire. Crucially we include "[unk]": all OTHER speech maps to unknown
    // instead of being forced onto a trigger word (the false-positive trap a
    // plain grammar falls into). This runs ALONGSIDE the free-form recognizer.
    private const val EN_GRAMMAR =
      "[\"help\", \"help help\", \"help me\", \"please help\", \"save me\", \"i need help\", \"[unk]\"]"
    private const val HI_GRAMMAR =
      "[\"बचाओ\", \"बचाओ बचाओ\", \"मदद\", \"मदद करो\", \"मुझे बचाओ\", \"[unk]\"]"

    // Single confident distress word. Requiring TWO shouts ("help help") to fire
    // roughly SQUARES the miss rate: if one "help" is caught ~80% of the time,
    // two-in-a-row is only ~64%. So a single distress word fires on its own IF
    // the recogniser is confident it really heard it. A mumbled, low-confidence
    // "help" still needs the two-shout / fusion paths below. The 5-second
    // countdown is the guard against the rare false single trigger.
    private val SINGLE_DISTRESS = setOf(
      "help", "bachao", "bacho", "madad", "madat", "बचाओ", "मदद",
    )
    // A single distress word fires on its own only when the recogniser is VERY
    // sure it heard it. Raised from 0.62 → 0.88: at 0.62 the small model was
    // emitting "help"/"madad" from TV chatter, other people talking nearby, and
    // half-caught words, firing the countdown when the user had said nothing to
    // it. A real, deliberate shout still clears 0.88; a mumbled or ambient
    // near-match now falls through to the stricter two-shout / repeat / fusion
    // paths instead of firing.
    private const val SINGLE_CONF = 0.88

    // Cross-utterance repeat detection. A panicked "help ... help" has a pause
    // between the shouts, so the two-word phrase " help help " may never appear
    // inside a single text — the phrase list alone can NEVER catch it. Hearing
    // a distress word twice (across two utterances within the window, or twice
    // anywhere in one text, e.g. "help please help") fires.
    //
    // Each group also carries NEAR-MISS forms: a shouted "help" is frequently
    // transcribed as "hell"/"held" by the small model, and Hindi "bachao" as
    // "bacho". A single near-miss does nothing; the same distress sound twice
    // in seconds is what fires, so ordinary speech stays safe.
    private val REPEAT_GROUPS = listOf(
      listOf("help", "hell", "held", "yelp"),
      listOf("बचाओ", "bachao", "bacho"),
      listOf("मदद", "madad", "madat"),
    )
    // Widened: a scared, muffled "help ... help" often has a long gap between
    // the two shouts, and short read frames mean each is a separate final.
    private const val REPEAT_WINDOW_MS = 12000L
  }

  @Volatile private var running = false
  private var screamDetector: ScreamDetector? = null
  /** Band-pass voice filter: strips out-of-band noise before VAD + ASR. */
  private var denoiser: VoiceDenoiser? = null
  private var phrases: List<String> = emptyList()
  @Volatile private var smoothedGain = 1.0
  /** Rolling window of raw mic audio, so evidence starts before the trigger. */
  @Volatile private var preRoll: PreRollBuffer? = null
  /** Estimated ambient noise level; the gate rides a margin above it. */
  @Volatile private var noiseFloor = 150.0
  /** Speech must exceed noiseFloor * this. Lower in whisper mode. */
  @Volatile private var gateMargin = NOISE_MARGIN
  /** The gate never drops below this. Lower in whisper mode. */
  @Volatile private var gateMin = MIN_GATE
  /** When a weak (non-firing) distress sound was last heard — fusion input. */
  @Volatile private var lastWeakDangerAt = 0L
  @Volatile private var lastWeakLabel = ""
  /** Liveness beacon. The loop stamps this into prefs every ~30s; if the OS
   *  kills us (aggressive OEM battery managers), it goes stale, and the app can
   *  detect the silent death on next foreground and re-arm. */
  @Volatile private var lastHeartbeatMs = 0L
  private var wakeLock: PowerManager.WakeLock? = null
  private val main = Handler(Looper.getMainLooper())

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Persist phrases + duration so a START_STICKY restart (null intent, after
    // the OS kills us) keeps listening for the SAME custom phrases.
    val prefs = getSharedPreferences("voiceguard", Context.MODE_PRIVATE)

    // HARD OFF GATE. A null intent means Android auto-restarted us (START_STICKY
    // after an OEM kill). If the user has turned Voice SOS OFF, we must NOT
    // resurrect the mic — stop immediately and stay dead. Only an explicit start
    // (real intent) or a self-heal while still enabled may listen. This is the
    // fix for "the mic is on even though I switched Voice SOS off".
    if (intent == null && !prefs.getBoolean("enabled", false)) {
      stopSelf()
      return START_NOT_STICKY
    }
    // A real (user/JS-initiated) start marks the guard as enabled, so a later
    // OEM kill CAN self-heal, but a user turn-off (which clears this) cannot be
    // undone by the OS.
    if (intent != null) prefs.edit().putBoolean("enabled", true).apply()
    val raw = intent?.getStringExtra(EXTRA_PHRASES)
    if (raw != null) prefs.edit().putString("phrases", raw).apply()
    val source = raw ?: prefs.getString("phrases", "") ?: ""
    val custom = source.split("\n").map { it.trim().lowercase() }.filter { it.length >= 3 }
    phrases = (custom + BUILT_IN).distinct()
    // Whisper mode persists across a START_STICKY restart, same as the phrases.
    if (intent != null && intent.hasExtra(EXTRA_WHISPER)) {
      prefs.edit().putBoolean("whisper", intent.getBooleanExtra(EXTRA_WHISPER, false)).apply()
    }
    if (prefs.getBoolean("whisper", false)) {
      gateMargin = WHISPER_MARGIN
      gateMin = WHISPER_MIN_GATE
    } else {
      gateMargin = NOISE_MARGIN
      gateMin = MIN_GATE
    }
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
      main.postDelayed({
        // Tell her the timed protection just ended, so it never lapses silently
        // and leave her feeling covered when she isn't. Then stop.
        notifyProtectionEnded()
        stopSelf()
      }, durationMs)
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
      // Plus a keyword-grammar recognizer for max confidence on the exact words.
      makeGrammarRecognizer(enModel, EN_GRAMMAR)?.let {
        recognizers.add(it)
        VoiceMetrics.grammarMode = true
      }
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
        makeGrammarRecognizer(hiModel, HI_GRAMMAR)?.let { recognizers.add(it) }
      } catch (e: Exception) {
        Log.e(TAG, "hindi model load failed", e)
      }
    }

    if (recognizers.isEmpty()) {
      notifyProtectionError()
      stopSelf()
      return
    }

    // Distress-sound layer (screaming / crying / glass) on the same stream.
    // Best-effort: if the model can't load, voice phrases still protect.
    screamDetector = try {
      ScreamDetector(
        this,
        onDanger = { label, score ->
          // A distress SOUND on its own (scream / crying / glass) NO LONGER
          // fires an SOS by itself. On-device sound classification false-fires
          // on TV, music, laughter, children playing and household noise, which
          // was opening the countdown with no word ever spoken. A sound now only
          // CORROBORATES a soft word: a scream plus "help"/"bachao" within a few
          // seconds still fires, but a sound alone never does. The spoken-word
          // paths (single confident word, "help help", repeat, phrase) remain
          // the only things that can fire on their own.
          VoiceMetrics.lastText = "[$label ${String.format("%.2f", score)}]"
          lastWeakDangerAt = System.currentTimeMillis()
          lastWeakLabel = label
          VoiceMetrics.screamScore = score.toDouble()
        },
        onWeak = { label, score ->
          // Not enough to fire. Remembered for a few seconds so that a soft
          // word ("help", "bachao") spoken alongside it becomes a trigger.
          lastWeakDangerAt = System.currentTimeMillis()
          lastWeakLabel = label
          VoiceMetrics.screamScore = score.toDouble()
        },
      )
    } catch (e: Exception) {
      Log.e(TAG, "scream detector unavailable", e)
      null
    }

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT,
    )
    val bufSize = maxOf(minBuf, SAMPLE_RATE) // ~1s internal buffer (read in 200ms frames)
    val record = try {
      AudioRecord(
        pickAudioSource(),
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

    val buffer = ShortArray(FRAME_SAMPLES)
    preRoll = PreRollBuffer(SAMPLE_RATE, PREROLL_SECONDS)
    denoiser = VoiceDenoiser(SAMPLE_RATE)
    prunePreRolls()
    VoiceMetrics.running = true
    var speechStart = 0L
    try {
      // Pin the phone's own mic BEFORE we start, so earphones can never make
      // Voice SOS deaf.
      preferBuiltInMic(record)
      record.startRecording()
      while (running) {
        val n = record.read(buffer, 0, buffer.size)
        if (n <= 0) continue
        // Liveness beacon: stamp "still alive" every ~30s (cheap, throttled).
        // Runs on every frame INCLUDING silence, so a quiet room never looks
        // like a killed service. Aggressive OEM task-killers stop this loop, so
        // a stale stamp is the app's proof the phone paused us.
        val hbNow = System.currentTimeMillis()
        if (hbNow - lastHeartbeatMs > 30_000L) {
          lastHeartbeatMs = hbNow
          try {
            getSharedPreferences("voiceguard", Context.MODE_PRIVATE)
              .edit().putLong("heartbeat", hbNow).apply()
          } catch (_: Exception) {}
        }
        // Keep EVERY frame, silence included, and keep it RAW (before the
        // denoiser/gain mutate the buffer). The seconds before she speaks are
        // the ones the old recording threw away, and evidence must stay real.
        preRoll?.write(buffer, n)
        // Band-pass to the voice range BEFORE the gate, so rumble/hiss can't
        // pass the VAD as "speech" and the recognizer hears a cleaner shout.
        denoiser?.process(buffer, n)
        val level = rms(buffer, n)
        VoiceMetrics.rms = level
        // Self-healing leak: drift the floor back toward the minimum every frame
        // (even during speech), so it can never get stuck high and deafen us.
        noiseFloor -= (noiseFloor - gateMin) * FLOOR_LEAK
        // Gate rides a margin above the tracked ambient noise floor.
        val gate = (noiseFloor * gateMargin).coerceIn(gateMin, MAX_GATE)
        VoiceMetrics.vadThreshold = gate
        val active = level >= gate
        VoiceMetrics.vadActive = active
        if (!active) {
          // Ambient frame: track the real noise level. Fall fast toward a
          // quieter room; rise only VERY slowly, so neither a transient nor a
          // muffled sub-gate shout can inflate the floor and ratchet the gate up.
          val rate = if (level > noiseFloor) 0.006 else 0.25
          noiseFloor += (level - noiseFloor) * rate
          // Speech just ended. The VAD gate means the recognizers never get
          // fed silence, so Vosk's endpointer can't finalise on its own —
          // WITHOUT this flush, final results (and cross-utterance repeat
          // detection with them) almost never happen. Flush explicitly.
          if (speechStart != 0L) {
            for (rec in recognizers) {
              try {
                val json = JSONObject(rec.finalResult)
                updateConfidence(json)
                val finalText = json.optString("text")
                confidentSingle(json, speechStart)
                maybeTrigger(finalText, speechStart)
                checkRepeatKeyword(finalText, speechStart, isFinal = true)
              } catch (e: Exception) {
                Log.w(TAG, "final flush failed", e)
              }
            }
          }
          speechStart = 0L
          continue // VAD: skip silence (no ASR, no gain → battery stays low)
        }
        if (speechStart == 0L) speechStart = System.currentTimeMillis()
        applyGain(buffer, n, level)
        for (rec in recognizers) {
          if (rec.acceptWaveForm(buffer, n)) {
            val json = JSONObject(rec.result)
            updateConfidence(json)
            val finalText = json.optString("text")
            confidentSingle(json, speechStart)
            maybeTrigger(finalText, speechStart)
            checkRepeatKeyword(finalText, speechStart, isFinal = true)
          } else {
            val partial = JSONObject(rec.partialResult).optString("partial")
            if (partial.isNotBlank()) VoiceMetrics.lastText = partial
            maybeTrigger(partial, speechStart)
            checkRepeatKeyword(partial, speechStart, isFinal = false)
          }
        }
        screamDetector?.feed(buffer, n)
      }
    } catch (e: Exception) {
      Log.e(TAG, "listen loop error", e)
    } finally {
      VoiceMetrics.running = false
      VoiceMetrics.vadActive = false
      try { record.stop() } catch (_: Exception) {}
      record.release()
      screamDetector?.close()
      screamDetector = null
      denoiser = null
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

  // A vocabulary-restricted recognizer: only the distress words + "[unk]". This
  // is keyword-spotting mode, the highest-confidence path for the exact words we
  // care about. Best-effort: if the grammar can't build (word not in the model's
  // dictionary, etc.) the free-form recognizer still fully protects.
  private fun makeGrammarRecognizer(model: Model, grammar: String): Recognizer? {
    return try {
      Recognizer(model, SAMPLE_RATE.toFloat(), grammar).apply { setWords(true) }
    } catch (e: Exception) {
      Log.w(TAG, "grammar recognizer unavailable", e)
      null
    }
  }

  // Pick the mic input best suited to far-field, muffled speech (bag/pocket).
  // UNPROCESSED gives the raw signal with the phone's own noise-suppressor and
  // AGC turned OFF — that processing is tuned for a phone held to your face and
  // actively eats muffled/quiet speech as "noise", the exact audio we must
  // keep. We then apply our own gentle gain. Not every device supports it, so
  // fall back to VOICE_RECOGNITION.
  private fun pickAudioSource(): Int {
    return try {
      val am = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
      val supported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
        am.getProperty(android.media.AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED) == "true"
      if (supported) MediaRecorder.AudioSource.UNPROCESSED
      else MediaRecorder.AudioSource.VOICE_RECOGNITION
    } catch (e: Exception) {
      MediaRecorder.AudioSource.VOICE_RECOGNITION
    }
  }

  // Force capture from the phone's OWN microphone. When earphones are plugged in
  // (especially mic-less music buds, or a Bluetooth headset that hasn't opened
  // an SCO link) Android reroutes recording to the headset, and Voice SOS goes
  // deaf — the exact moment she still expects the phone to hear her shout. The
  // environment mic must always be the one listening, so we pin it and re-pin it
  // if the OS ever moves the route (headset connected/disconnected mid-session).
  private fun preferBuiltInMic(record: AudioRecord) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
    try {
      val am = getSystemService(Context.AUDIO_SERVICE) as android.media.AudioManager
      val builtIn = am.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS)
        .firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC }
      if (builtIn != null) {
        val ok = record.setPreferredDevice(builtIn)
        Log.i(TAG, "pin built-in mic ok=$ok (guards against headset routing)")
      } else {
        Log.w(TAG, "no built-in mic device found to pin")
      }
      // Re-assert the built-in mic whenever the routing actually changes, so
      // plugging earphones in AFTER arming can't silently steal the input.
      val listener = object : android.media.AudioRouting.OnRoutingChangedListener {
        override fun onRoutingChanged(router: android.media.AudioRouting) {
          try {
            if (record.routedDevice?.type != android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC) {
              val mic = am.getDevices(android.media.AudioManager.GET_DEVICES_INPUTS)
                .firstOrNull { it.type == android.media.AudioDeviceInfo.TYPE_BUILTIN_MIC }
              if (mic != null) {
                record.setPreferredDevice(mic)
                Log.i(TAG, "re-pinned built-in mic after route change")
              }
            }
          } catch (e: Exception) {
            Log.w(TAG, "routing re-pin failed", e)
          }
        }
      }
      record.addOnRoutingChangedListener(listener, null)
    } catch (e: Exception) {
      Log.w(TAG, "could not pin built-in mic", e)
    }
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

  // Fire on a SINGLE distress word if the recogniser is confident. Only runs on
  // finals (the "result" array carries per-word confidence; partials don't), so
  // one clear "help" triggers, while a mumbled fragment falls through to the
  // stricter two-shout / fusion paths.
  private fun confidentSingle(json: JSONObject, speechStart: Long) {
    val arr = json.optJSONArray("result") ?: return
    for (i in 0 until arr.length()) {
      val w = arr.getJSONObject(i)
      val word = w.optString("word").lowercase().trim()
      if (word in SINGLE_DISTRESS && w.optDouble("conf", 0.0) >= SINGLE_CONF) {
        triggerNow(word, speechStart)
        return
      }
    }
  }

  @Volatile private var lastFire = 0L
  private val lastKeywordAt = HashMap<String, Long>()

  private fun maybeTrigger(text: String?, speechStart: Long) {
    if (text.isNullOrBlank()) return
    // STRICT whole-word / whole-phrase match. Pad with spaces so " help "
    // matches the word "help" but NOT "hello" / "helping" / "yellow". This is
    // what stops ordinary speech from firing an SOS.
    val t = " " + text.lowercase().trim().replace(Regex("\\s+"), " ") + " "
    val hit = phrases.firstOrNull { t.contains(" $it ") }
    if (hit != null) {
      triggerNow(hit, speechStart)
      return
    }
    // FUSION. A soft word never fires by itself — "help" and "no" are far too
    // common. But if a distress sound was heard within the last few seconds at
    // a score too weak to fire on its own, the pair is strong evidence and both
    // thresholds can safely be lower than either could be alone.
    val now = System.currentTimeMillis()
    if (now - lastWeakDangerAt <= FUSION_WINDOW_MS) {
      val soft = SOFT_WORDS.firstOrNull { t.contains(" $it ") }
      if (soft != null) {
        triggerNow("$lastWeakLabel+$soft", speechStart)
        lastWeakDangerAt = 0L // consume it; don't re-fire on the next partial
      }
    }
  }

  // Repeat detection. Two paths:
  //  • ≥2 group hits ANYWHERE in one text ("help please help", "help hell") →
  //    fire. Safe to run on partials too: two occurrences means two shouts.
  //  • Cross-utterance: a single hit is timestamped ONLY on finals (partials
  //    repeat while an utterance grows, so they'd count one shout many times);
  //    a hit in two separate finals within the window → fire.
  private fun checkRepeatKeyword(text: String?, speechStart: Long, isFinal: Boolean) {
    if (text.isNullOrBlank()) return
    val words = text.lowercase().trim().split(Regex("\\s+"))
    val now = System.currentTimeMillis()
    for ((gi, group) in REPEAT_GROUPS.withIndex()) {
      val count = words.count { it in group }
      if (count == 0) continue
      if (count >= 2) {
        triggerNow("${group[0]} ${group[0]}", speechStart)
        return
      }
      if (isFinal) {
        val key = "g$gi"
        val prev = lastKeywordAt[key] ?: 0L
        lastKeywordAt[key] = now
        if (now - prev <= REPEAT_WINDOW_MS) {
          triggerNow("${group[0]} ${group[0]}", speechStart)
          return
        }
      }
    }
  }

  private fun triggerNow(hit: String, speechStart: Long) {
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
    // Freeze the 15 seconds that led up to this. Best-effort: a failed dump
    // must never stop the SOS from firing.
    val preRollPath = try {
      preRoll?.dumpWav(File(filesDir, PREROLL_DIR), "preroll_$now.wav")?.absolutePath
    } catch (e: Exception) {
      Log.w(TAG, "pre-roll dump failed", e)
      null
    }
    fireSos(hit, preRollPath)
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
  /**
   * Pre-roll clips are raw audio of the user's life. Once the JS layer has
   * uploaded (or abandoned) one, it has no reason to linger — drop anything
   * older than a day so a phone never accumulates recordings.
   */
  private fun prunePreRolls() {
    try {
      val dir = File(filesDir, PREROLL_DIR)
      if (!dir.isDirectory) return
      val cutoff = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
      dir.listFiles()?.forEach { f -> if (f.lastModified() < cutoff) f.delete() }
    } catch (e: Exception) {
      Log.w(TAG, "pre-roll prune failed", e)
    }
  }

  private fun fireSos(phrase: String? = null, preRollPath: String? = null) {
    // Carry the trigger metadata to the JS layer: `phrase` lets us measure the
    // false-positive rate per phrase (a cancelled countdown IS a false
    // positive), and `preroll` points at the audio from before she spoke.
    val uri = StringBuilder("orbii://voice-sos")
    val params = mutableListOf<String>()
    phrase?.let { params.add("phrase=" + Uri.encode(it)) }
    preRollPath?.let { params.add("preroll=" + Uri.encode(it)) }
    if (params.isNotEmpty()) uri.append("?").append(params.joinToString("&"))

    val deepLink = Intent(Intent.ACTION_VIEW, Uri.parse(uri.toString())).apply {
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

  // A timed Voice SOS session just ran out. Tell her clearly (a heads-up alert,
  // not a jarring full-screen takeover for an "it turned off" event) so she is
  // never left believing she's protected when the timer has lapsed. Tapping
  // reopens ORBII to turn it back on.
  private fun notifyProtectionEnded() {
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pi = PendingIntent.getActivity(
      this, 3, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val n = Notification.Builder(this, CH_ALERT)
      .setSmallIcon(resources.getIdentifier("notification_icon", "drawable", packageName))
      .setContentTitle("Voice SOS protection ended")
      .setContentText("Your timed protection is now off. Tap to turn it back on.")
      .setPriority(Notification.PRIORITY_HIGH)
      .setContentIntent(pi)
      .setAutoCancel(true)
      .build()
    nm().notify(ALERT_ID + 2, n)
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
      .setContentText("Listening. Shout \"help, help\" if you need me.")
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
  @Volatile var screamScore = 0.0

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
