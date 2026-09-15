package com.orbii.app.voice

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * The deliberate shake: an opt-in way to raise a SILENT SOS without saying a word.
 *
 * WHAT COUNTS. Ten hard strokes inside two and a half seconds. A stroke is a
 * moment where the phone's acceleration on top of gravity passes 22 m/s^2, and
 * two peaks closer together than 110 ms are one stroke, not two.
 *
 * WHY THOSE NUMBERS. Ten strokes in 2.5 s is four a second. Running, the commonest
 * thing that shakes a phone hard and rhythmically, tops out around three steps a
 * second, and a phone in a pocket rarely clears 22 m/s^2 on every one of them.
 * Somebody gripping the phone and shaking it on purpose does both easily.
 *
 * None of these thresholds has been measured on the handsets ORBII ships to. That
 * is why this is off by default, and why a match can only ever open the
 * countdown. It can never send an SOS by itself.
 *
 * The rule is pure (ShakePattern) so it can be read and reasoned about without a
 * device. Everything sensor-shaped lives in ShakeDetector.
 */
class ShakePattern(
  private val strokeMs2: Double = STROKE_MS2,
  private val strokes: Int = STROKES,
  private val windowMs: Long = WINDOW_MS,
  private val minGapMs: Long = MIN_GAP_MS,
  private val cooldownMs: Long = COOLDOWN_MS,
) {
  companion object {
    const val STROKE_MS2 = 22.0
    const val STROKES = 10
    const val WINDOW_MS = 2_500L
    const val MIN_GAP_MS = 110L
    const val COOLDOWN_MS = 30_000L
  }

  // java.util.ArrayDeque on purpose: its pollFirst/peekFirst exist on every
  // Android version, which is not true of every Kotlin collection call once the
  // app is compiled against JDK 21.
  private val times = java.util.ArrayDeque<Long>()
  private var lastStrokeAt = -1L
  private var lastFiredAt: Long? = null

  /** Feed one sample: net acceleration above gravity, and when. True means fire. */
  fun feed(netMs2: Double, at: Long): Boolean {
    val fired = lastFiredAt
    if (fired != null && at - fired < cooldownMs) return false
    prune(at)
    if (netMs2 < strokeMs2) return false
    if (lastStrokeAt >= 0 && at - lastStrokeAt < minGapMs) return false
    lastStrokeAt = at
    times.addLast(at)
    if (times.size >= strokes) {
      times.clear()
      lastFiredAt = at
      return true
    }
    return false
  }

  private fun prune(at: Long) {
    while (true) {
      val first = times.peekFirst() ?: return
      if (at - first <= windowMs) return
      times.pollFirst()
    }
  }
}

class ShakeDetector(
  private val ctx: Context,
  private val onShake: () -> Unit,
) : SensorEventListener {

  companion object {
    private const val TAG = "ShakeDetector"
  }

  private val sm: SensorManager? =
    try { ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager } catch (e: Exception) { null }

  private val pattern = ShakePattern()
  @Volatile private var started = false

  fun start() {
    val manager = sm ?: return
    if (started) return
    try {
      val accel = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
      // GAME, about 50 Hz. A deliberate shake is four to six strokes a second,
      // and the NORMAL rate SensorContext uses, about 5 Hz, cannot see a single
      // one of them. It costs battery, which is why it is only registered while
      // she has the feature switched on.
      manager.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
      started = true
      Log.i(TAG, "shake detector armed")
    } catch (e: Exception) {
      Log.w(TAG, "shake sensor registration failed", e)
    }
  }

  fun stop() {
    try {
      sm?.unregisterListener(this)
    } catch (e: Exception) {
      Log.w(TAG, "unregister failed", e)
    }
    started = false
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    val e = event ?: return
    if (e.sensor.type != Sensor.TYPE_ACCELEROMETER) return
    val x = e.values.getOrElse(0) { 0f }.toDouble()
    val y = e.values.getOrElse(1) { 0f }.toDouble()
    val z = e.values.getOrElse(2) { 0f }.toDouble()
    val net = abs(sqrt(x * x + y * y + z * z) - SensorManager.GRAVITY_EARTH)
    if (pattern.feed(net, System.currentTimeMillis())) {
      Log.i(TAG, "deliberate shake matched")
      confirmPulse()
      try {
        onShake()
      } catch (ex: Exception) {
        Log.w(TAG, "onShake threw", ex)
      }
    }
  }

  /**
   * One short pulse, so she knows it registered. Felt rather than heard, and the
   * only feedback a silent SOS gives on purpose.
   */
  private fun confirmPulse() {
    try {
      val v = ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        v.vibrate(VibrationEffect.createOneShot(90, VibrationEffect.DEFAULT_AMPLITUDE))
      } else {
        @Suppress("DEPRECATION")
        v.vibrate(90)
      }
    } catch (_: Exception) {
      // A missing pulse must never stop the trigger.
    }
  }
}
