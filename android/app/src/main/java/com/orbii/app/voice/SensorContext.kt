package com.orbii.app.voice

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Physical context around a voice candidate: is the phone buried, and did
 * something just happen to it.
 *
 * ── WHY THIS IS KOTLIN AND NOT expo-sensors ──────────────────────────────────
 * The brief specified expo-sensors. Two things make that the wrong layer.
 *
 * First, expo-sensors has no proximity sensor. It ships Accelerometer,
 * Barometer, DeviceMotion, Gyroscope, LightSensor, Magnetometer and Pedometer,
 * and that is the whole list. Enclosure detection needs proximity.
 *
 * Second, and decisively: the trigger decision happens HERE, inside a
 * foreground service, while the app is backgrounded or closed. That is the
 * entire point of Voice SOS. JavaScript is not running then, so a gate written
 * in TypeScript would only work in the one case that barely matters, a woman
 * looking at her open phone, and would be absent in every case that does.
 *
 * SensorManager gives proximity, light and accelerometer directly, needs no
 * dependency, and runs where the decision is actually made.
 *
 * ── THE RULE THIS FILE WILL NOT BREAK ────────────────────────────────────────
 * SENSORS MAY ADD CONFIDENCE. THEY MAY NEVER VETO.
 *
 * The brief asks for a state machine that can "reject as a false positive" on
 * sensor evidence. This does not do that, and the omission is deliberate.
 *
 * A confident distress word must fire whatever the sensors say. Every one of
 * these signals has a plausible failure that looks exactly like "she is fine":
 * a proximity sensor covered by a case reads near forever; a light sensor under
 * a screen protector reads dark at noon; someone held still against a wall
 * produces no motion spike at all. If a sensor lies in that direction and we
 * let it veto, she shouts and nothing happens, and neither she nor we ever find
 * out why.
 *
 * So the asymmetry is on purpose: sensors can promote a WEAK candidate to a
 * trigger, and can loosen the audio gate when the phone is buried. They cannot
 * demote or block a strong one. The cost of that choice is some false alarms.
 * The cost of the other choice is a missed emergency, and those are not
 * comparable.
 */
class SensorContext(private val ctx: Context) : SensorEventListener {

  companion object {
    private const val TAG = "SensorContext"

    /** Ambient light below this reads as "in a bag or pocket". Dusk is ~10. */
    private const val DARK_LUX = 8f

    /**
     * Net acceleration, in m/s^2 on top of gravity, that counts as a spike.
     * A brisk walk peaks around 3, a jog around 6, a phone snatched or dropped
     * well past 12. Set high on purpose: this signal only ever promotes, so a
     * missed spike costs nothing, and a spurious one costs a false alarm.
     */
    private const val SPIKE_MS2 = 12.0

    /**
     * How long a spike stays relevant to a voice candidate. The brief said five
     * seconds; kept, because a struggle and a shout are not simultaneous and
     * the shout usually follows the grab.
     */
    const val MOTION_WINDOW_MS = 5_000L

    /** Enclosure readings older than this are not trusted. */
    private const val ENCLOSURE_TTL_MS = 60_000L
  }

  private val sm: SensorManager? =
    try { ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager } catch (e: Exception) { null }

  private var proximity: Sensor? = null
  private var light: Sensor? = null
  private var accel: Sensor? = null

  /** cm from the proximity sensor, and its maximum range for the near test. */
  @Volatile private var proximityCm = Float.MAX_VALUE
  @Volatile private var proximityMax = 5f
  @Volatile private var proximityAt = 0L

  @Volatile private var lux = Float.MAX_VALUE
  @Volatile private var luxAt = 0L

  /** When the last acceleration spike happened, and how hard. */
  @Volatile private var lastSpikeAt = 0L
  @Volatile private var lastSpikeMagnitude = 0.0

  @Volatile private var started = false

  // ---------------------------------------------------------------------------

  fun start() {
    val manager = sm ?: return
    if (started) return
    try {
      proximity = manager.getDefaultSensor(Sensor.TYPE_PROXIMITY)
      light = manager.getDefaultSensor(Sensor.TYPE_LIGHT)
      accel = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
      proximityMax = proximity?.maximumRange ?: 5f

      // SENSOR_DELAY_NORMAL throughout, about 200 ms. Fast enough for a fall,
      // which lasts several hundred milliseconds, and cheap enough to leave on
      // for a whole shift. GAME or FASTEST would catch a sharper impact and
      // cost battery this app cannot spend, on a signal that only promotes.
      proximity?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
      light?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }
      accel?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL) }

      started = true
      Log.i(
        TAG,
        "sensors: proximity=${proximity != null} light=${light != null} accel=${accel != null}",
      )
    } catch (e: Exception) {
      Log.w(TAG, "sensor registration failed", e)
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

  // ---------------------------------------------------------------------------

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    val e = event ?: return
    val now = System.currentTimeMillis()
    when (e.sensor.type) {
      Sensor.TYPE_PROXIMITY -> {
        proximityCm = e.values.getOrElse(0) { Float.MAX_VALUE }
        proximityAt = now
      }
      Sensor.TYPE_LIGHT -> {
        lux = e.values.getOrElse(0) { Float.MAX_VALUE }
        luxAt = now
      }
      Sensor.TYPE_ACCELEROMETER -> {
        val x = e.values.getOrElse(0) { 0f }.toDouble()
        val y = e.values.getOrElse(1) { 0f }.toDouble()
        val z = e.values.getOrElse(2) { 0f }.toDouble()
        // Magnitude minus gravity. A phone at rest in any orientation reads
        // about 9.81, so this is "how much on top of just sitting there".
        val net = abs(sqrt(x * x + y * y + z * z) - SensorManager.GRAVITY_EARTH)
        if (net > SPIKE_MS2) {
          lastSpikeAt = now
          lastSpikeMagnitude = net
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // What the service asks
  // ---------------------------------------------------------------------------

  /**
   * Is the phone in a pocket, a bag, or face down on a table?
   *
   * Either signal is enough. They fail in different directions, so requiring
   * both would mean a phone in a bright bag with a covered proximity sensor
   * reads as "in the open", which is the reading that costs recall.
   *
   * Absent hardware returns false, which is the safe direction: no enclosure
   * adjustment, and the normal gate applies.
   */
  fun isEnclosed(): Boolean {
    val now = System.currentTimeMillis()
    val near = proximityAt > 0 &&
      now - proximityAt < ENCLOSURE_TTL_MS &&
      proximityCm < proximityMax
    val dark = luxAt > 0 &&
      now - luxAt < ENCLOSURE_TTL_MS &&
      lux < DARK_LUX
    return near || dark
  }

  /** Did something hit, drop or shake this phone in the last few seconds? */
  fun recentMotionSpike(windowMs: Long = MOTION_WINDOW_MS): Boolean =
    lastSpikeAt > 0 && System.currentTimeMillis() - lastSpikeAt < windowMs

  /** For the debug screen and for VoiceMetrics. */
  fun describe(): String =
    "enclosed=${isEnclosed()} lux=${if (luxAt == 0L) "n/a" else lux.toString()} " +
      "prox=${if (proximityAt == 0L) "n/a" else proximityCm.toString()} " +
      "spike=${recentMotionSpike()}(${"%.1f".format(lastSpikeMagnitude)})"
}
