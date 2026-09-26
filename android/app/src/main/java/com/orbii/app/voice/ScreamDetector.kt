package com.orbii.app.voice

import android.content.Context
import android.util.Log
import org.tensorflow.lite.Interpreter
import java.io.BufferedReader
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.InputStreamReader
import java.nio.MappedByteBuffer
import java.nio.channels.FileChannel

/**
 * On-device distress-SOUND detection (YAMNet, bundled TFLite, ~4 MB).
 *
 * Listens for what words can't say: screaming, crying, breaking glass. Runs on
 * the SAME gated audio stream as the speech recognizers (so silence costs
 * nothing), entirely offline; no audio ever leaves the phone.
 *
 * Deliberately conservative: a scream must be either very confident once or
 * confident twice in a row before it fires, and the whole detector disables
 * itself on any internal failure so it can never take down the guard service.
 */
class ScreamDetector(
  context: Context,
  private val onDanger: (label: String, score: Float) -> Unit,
  /** A sound too weak to fire alone, but usable to corroborate a soft word. */
  private val onWeak: (label: String, score: Float) -> Unit = { _, _ -> },
) {
  companion object {
    private const val TAG = "ScreamDetector"
    private const val MODEL_ASSET = "yamnet.tflite"
    private const val CLASS_MAP_ASSET = "yamnet_class_map.csv"
    private const val WINDOW = 15600      // 0.975s @ 16kHz, YAMNet's input size
    private const val INFER_EVERY = 12000 // ~0.75s of new samples per inference
  }

  private data class Target(
    val name: String,
    val index: Int,
    val fireOnce: Float,   // single-window score that fires immediately
    val fireTwice: Float,  // score that fires when seen twice in a row
    // Never fires alone. Only corroborates a distress word heard nearby in
    // time. Raised from 0.40: at that score YAMNet was flagging a television,
    // a laugh and ordinary loud conversation as weak evidence of danger, which
    // then sat waiting for any word to pair with.
    val corroborate: Float = 0.62f,
  )

  private var interpreter: Interpreter? = null
  private var targets: List<Target> = emptyList()
  private var inputIs2d = false
  private var outputLen = 521
  private var enabled = false
  private var failures = 0

  private val window = FloatArray(WINDOW)
  private var filled = 0
  private var sinceInfer = 0
  private val lastAbove = HashMap<Int, Boolean>()

  init {
    try {
      val model = mapAsset(context)
      val opts = Interpreter.Options().apply { setNumThreads(2) }
      val interp = Interpreter(model, opts)
      val inShape = interp.getInputTensor(0).shape()
      inputIs2d = inShape.size == 2
      outputLen = interp.getOutputTensor(0).shape().last()
      interpreter = interp

      // Resolve class indices by NAME from the bundled class map, so a model
      // update can never silently shift which sounds we react to.
      val byName = HashMap<String, Int>()
      context.assets.open(CLASS_MAP_ASSET).use { s ->
        BufferedReader(InputStreamReader(s)).useLines { lines ->
          lines.drop(1).forEach { line ->
            val idx = line.substringBefore(',').toIntOrNull() ?: return@forEach
            val name = line.substringAfter(',').substringAfter(',')
              .trim().trim('"')
            byName[name] = idx
          }
        }
      }
      // RETUNED 26 September 2026, after Voice SOS was reported firing by
      // itself from the moment it was switched on.
      //
      // WHAT YAMNET ACTUALLY CONFUSES. "Screaming" is not a rare class. It sits
      // next to shouting, laughing, cheering, singing and children playing, and
      // a television in the same room produces all of them. At the old 0.55
      // two-window threshold an excited living room cleared it regularly.
      //
      // NOTHING FIRES ON A SINGLE WINDOW ANY MORE. A window is 0.975 seconds. A
      // real scream lasts longer than that; a laugh or a clatter often does
      // not. Requiring two consecutive windows costs about three quarters of a
      // second in a real emergency, where the countdown is five, and removes
      // the entire class of one-off spikes. fireOnce is set above 1.0, which no
      // score can reach, rather than deleted, so the shape of the rule stays
      // visible.
      //
      // CRYING AND GLASS NO LONGER FIRE AT ALL. Both are now corroboration
      // only. A baby, a sad film, a dropped plate and a slammed door are
      // ordinary domestic sounds, and neither one is evidence somebody is in
      // danger. They can still strengthen a distress WORD heard seconds later,
      // which is the only use that was ever defensible.
      targets = listOfNotNull(
        // Two consecutive windows at 0.80. Was one window at 0.80, or two at
        // 0.55.
        byName["Screaming"]?.let { Target("scream", it, 1.1f, 0.80f, 0.62f) },
        byName["Crying, sobbing"]?.let { Target("crying", it, 1.1f, 1.1f, 0.75f) },
        byName["Shatter"]?.let { Target("glass", it, 1.1f, 1.1f, 0.70f) },
      )
      enabled = targets.isNotEmpty()
      Log.i(TAG, "ready targets=${targets.map { "${it.name}@${it.index}" }} in2d=$inputIs2d out=$outputLen")
    } catch (e: Exception) {
      Log.e(TAG, "init failed — scream detection off", e)
      enabled = false
    }
  }

  // The model ships COMPRESSED in the APK (smaller download) and is unpacked
  // to private storage once, then memory-mapped from there, same pattern as
  // the bundled speech models.
  private fun mapAsset(context: Context): MappedByteBuffer {
    val f = File(context.filesDir, MODEL_ASSET)
    if (!f.exists() || f.length() < 1_000_000L) {
      context.assets.open(MODEL_ASSET).use { input ->
        FileOutputStream(f).use { out -> input.copyTo(out, 1 shl 16) }
      }
    }
    FileInputStream(f).use { input ->
      return input.channel.map(FileChannel.MapMode.READ_ONLY, 0, f.length())
    }
  }

  /** Feed gated (post-VAD) audio. Called from the audio thread. */
  fun feed(buffer: ShortArray, n: Int) {
    if (!enabled) return
    try {
      var i = 0
      while (i < n) {
        // Ring-shift when full: keep the newest WINDOW samples.
        if (filled == WINDOW) {
          val shift = minOf(n - i, WINDOW / 4)
          System.arraycopy(window, shift, window, 0, WINDOW - shift)
          filled = WINDOW - shift
        }
        val copy = minOf(n - i, WINDOW - filled)
        for (j in 0 until copy) {
          window[filled + j] = buffer[i + j] / 32768.0f
        }
        filled += copy
        i += copy
        sinceInfer += copy
      }
      if (filled == WINDOW && sinceInfer >= INFER_EVERY) {
        sinceInfer = 0
        infer()
      }
    } catch (e: Exception) {
      if (++failures >= 3) {
        enabled = false
        Log.e(TAG, "disabled after repeated failures", e)
      }
    }
  }

  private fun infer() {
    val interp = interpreter ?: return
    val scores: FloatArray
    if (inputIs2d) {
      val out = Array(1) { FloatArray(outputLen) }
      interp.run(arrayOf(window), out)
      scores = out[0]
    } else {
      val out = Array(1) { FloatArray(outputLen) }
      interp.run(window, out)
      scores = out[0]
    }
    for (t in targets) {
      if (t.index >= scores.size) continue
      val s = scores[t.index]
      if (t.name == "scream") VoiceMetrics.screamScore = s.toDouble()
      val wasAbove = lastAbove[t.index] == true
      val above = s >= t.fireTwice
      lastAbove[t.index] = above
      if (s >= t.fireOnce || (above && wasAbove)) {
        Log.i(TAG, "danger sound: ${t.name} score=$s")
        onDanger(t.name, s)
        lastAbove[t.index] = false
        return
      }
      // Corroboration tier: too weak to fire on its own, but real evidence
      // that something is wrong. VoiceGuardService remembers it briefly, and a
      // soft word like "help" or "bachao" — which is far too common to fire
      // alone — becomes a trigger when it lands inside this window. Neither
      // signal is trusted by itself; together they are.
      if (s >= t.corroborate) {
        onWeak(t.name, s)
      }
    }
  }

  fun close() {
    enabled = false
    try { interpreter?.close() } catch (_: Exception) {}
    interpreter = null
  }
}
