package com.orbii.app.voice

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Looper
import android.util.Log
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Crash detection.
 *
 * ── WHY THIS IS NOT volumetricShock.ts ───────────────────────────────────────
 * There is already an impact detector in JavaScript. It cannot do this job, for
 * two reasons that no amount of tuning fixes.
 *
 * It is foreground only. It stops the moment the app is backgrounded, and a car
 * crash happens with the phone in a cupholder and ORBII closed. The one place it
 * runs is the one place a crash almost never happens.
 *
 * And it has no idea how fast she was going. An accelerometer alone cannot tell
 * a 50 km/h collision from a phone hitting a tiled floor, because at the phone
 * they look similar. That is why that detector had to be set so conservatively
 * that it was never switched on.
 *
 * ── THE IDEA THAT MAKES THIS WORK ────────────────────────────────────────────
 * SPEED IS THE GATE. Not acceleration.
 *
 * The detector is inert below vehicle speed. A phone dropped on a desk is doing
 * 0 km/h. A phone falling out of a pocket while she walks is doing 5. Neither
 * ever reaches the impact test, so the entire class of false positive that kept
 * the old detector switched off is gone by construction rather than by tuning.
 *
 * What is left is a three-part signature that ordinary driving does not produce:
 *
 *   1. She was travelling at vehicle speed.
 *   2. A hard impact.
 *   3. The speed collapsed and stayed collapsed.
 *
 * Part three is what rejects potholes and speed bumps for free. A bad pothole at
 * 45 km/h produces a large spike, and five seconds later she is still doing 45,
 * so it is discarded without ever needing a cleverer threshold.
 *
 * ── THE RULE THIS FILE WILL NOT BREAK ────────────────────────────────────────
 * A MATCH OPENS THE COUNTDOWN. IT NEVER SENDS AN SOS.
 *
 * Same rule as ShakeDetector and the same reason. The countdown is the only
 * check that is never wrong, because she can answer it. If she is unconscious
 * it completes on its own, which is the entire point of detecting a crash.
 *
 * NO SPEED, NO FIRING. If there is no recent location fix the detector cannot
 * match, whatever the accelerometer says. Underground parking, a tunnel, GPS
 * denied: all of them mean this feature is quietly absent rather than guessing.
 * Missing a crash is bad. Sending strangers to an address because someone
 * dropped a phone in a basement is worse, and it is the failure that gets the
 * feature switched off by every user who sees it.
 *
 * ── SHADOW MODE ─────────────────────────────────────────────────────────────
 * Every constant below is reasoned, not measured. Published collision data is
 * about vehicle structures, not about a phone loose in a cupholder, and the
 * difference is large. So this ships logging-only: the detector runs for real
 * against real driving, every decision and rejection is recorded, and after a
 * week of actual road use the numbers get set from data instead of from an
 * argument. Until that happens the honest state of this feature is unknown.
 */
class CrashPattern(
  private val armSpeedMs: Double = ARM_SPEED_MS,
  private val impactMs2: Double = IMPACT_MS2,
  private val stoppedSpeedMs: Double = STOPPED_SPEED_MS,
  private val collapseWindowMs: Long = COLLAPSE_WINDOW_MS,
  private val speedTtlMs: Long = SPEED_TTL_MS,
  private val cooldownMs: Long = COOLDOWN_MS,
) {
  companion object {
    /**
     * 25 km/h in m/s. Below this the detector is inert.
     *
     * Chosen to sit above running and cycling and below any real road speed, so
     * that a phone dropped by someone on foot can never reach the impact test.
     */
    const val ARM_SPEED_MS = 6.9

    /**
     * Net acceleration above gravity, m/s^2, that counts as a collision.
     *
     * Deliberately far above ShakeDetector's 22, which a person can produce with
     * their arm, and above SensorContext's 12, which a brisk drop produces. A
     * phone is not bolted to the car, so it sees a fraction of the vehicle's
     * deceleration, which is why this is not set at the tens of g a crash test
     * would suggest.
     */
    const val IMPACT_MS2 = 35.0

    /** 8 km/h in m/s. Below this she has effectively stopped. */
    const val STOPPED_SPEED_MS = 2.2

    /** The speed must collapse within this long of the impact. */
    const val COLLAPSE_WINDOW_MS = 10_000L

    /**
     * A location fix older than this is not trusted, and without a trusted fix
     * nothing can fire. Fifteen seconds at road speed is a few hundred metres,
     * which is already too stale to reason about.
     */
    const val SPEED_TTL_MS = 15_000L

    /** One candidate per minute, so a tumbling phone cannot queue several. */
    const val COOLDOWN_MS = 60_000L
  }

  /** Why a candidate was rejected. Logged, so the thresholds can be tuned. */
  enum class Reject { NOT_MOVING, NO_FIX, BELOW_IMPACT, COOLING_DOWN, RESUMED, NEVER_STOPPED }

  private var armedAt = 0L
  private var impactAt = 0L
  private var impactMagnitude = 0.0
  private var speedAtImpact = 0.0
  private var lastFiredAt: Long? = null

  /** Last speed we were told about, and when. */
  private var speedMs = -1.0
  private var speedAt = 0L

  fun onSpeed(ms: Double, at: Long) {
    speedMs = ms
    speedAt = at
  }

  /** True if a fix is present and recent enough to reason about. */
  private fun hasFix(at: Long): Boolean = speedAt > 0 && at - speedAt <= speedTtlMs && speedMs >= 0

  /**
   * Feed one acceleration sample. Returns a rejection reason, or null when the
   * sample completed the full crash signature and the countdown should open.
   */
  fun feed(netMs2: Double, at: Long): Reject? {
    val fired = lastFiredAt
    if (fired != null && at - fired < cooldownMs) return Reject.COOLING_DOWN
    if (!hasFix(at)) return Reject.NO_FIX

    // Stage two: an impact already happened, we are waiting to see whether the
    // speed collapsed and stayed collapsed.
    if (impactAt > 0L) {
      val since = at - impactAt
      if (speedMs >= armSpeedMs) {
        // Still driving. A pothole, a speed bump, a slammed door.
        reset()
        return Reject.RESUMED
      }
      if (speedMs <= stoppedSpeedMs) {
        impactAt = 0L
        lastFiredAt = at
        return null
      }
      if (since > collapseWindowMs) {
        reset()
        return Reject.NEVER_STOPPED
      }
      return Reject.NEVER_STOPPED
    }

    // Stage one: are we even moving, and was that an impact?
    if (speedMs < armSpeedMs) return Reject.NOT_MOVING
    if (netMs2 < impactMs2) return Reject.BELOW_IMPACT

    impactAt = at
    impactMagnitude = netMs2
    speedAtImpact = speedMs
    return Reject.NEVER_STOPPED
  }

  private fun reset() {
    impactAt = 0L
    impactMagnitude = 0.0
    speedAtImpact = 0.0
  }

  /** For the shadow log, so a rejection can be read back with its numbers. */
  fun describe(): String =
    "speed=%.1f fixAgeMs=%d impactMs2=%.1f speedAtImpact=%.1f".format(
      speedMs,
      if (speedAt == 0L) -1 else System.currentTimeMillis() - speedAt,
      impactMagnitude,
      speedAtImpact,
    )
}

/**
 * The sensor and location plumbing. Everything decidable lives in CrashPattern.
 */
class CrashDetector(
  private val ctx: Context,
  /** Called only when the full signature matched. Must open the countdown. */
  private val onCrash: () -> Unit,
  /** Every decision, including rejections, for the shadow log. */
  private val onEvent: (String) -> Unit,
  /** While true the detector runs for real and onCrash is unreachable. */
  private val shadowMode: Boolean = true,
) : SensorEventListener, LocationListener {

  companion object {
    private const val TAG = "CrashDetector"

    /**
     * How often we ask for a location. 5 seconds, not continuous.
     *
     * The gate only needs to know roughly how fast she is going, not where she
     * is. GPS at 0.2 Hz alongside a foreground service that is already running
     * the microphone is a cost this feature can justify; continuous updates are
     * not.
     */
    private const val LOCATION_INTERVAL_MS = 5_000L
    private const val LOCATION_MIN_DISTANCE_M = 0f

    /**
     * How long she must be below vehicle speed before the fast accelerometer is
     * stood down. Comfortably longer than the collapse window, so a crash can
     * always finish confirming, and long enough that a traffic light does not
     * cost a deregister and register every thirty seconds.
     */
    private const val ACCEL_HOLD_MS = 60_000L

    /** Rejections are noisy. Only this reason is worth logging every time. */
    private val LOUD_REJECTS = setOf(
      CrashPattern.Reject.RESUMED,
      CrashPattern.Reject.NEVER_STOPPED,
    )
  }

  private val sm: SensorManager? =
    try { ctx.getSystemService(Context.SENSOR_SERVICE) as? SensorManager } catch (e: Exception) { null }

  private val lm: LocationManager? =
    try { ctx.getSystemService(Context.LOCATION_SERVICE) as? LocationManager } catch (e: Exception) { null }

  private val pattern = CrashPattern()
  @Volatile private var started = false
  @Volatile private var lastImpactLoggedAt = 0L
  /** Whether the 50 Hz accelerometer is currently registered. */
  @Volatile private var accelRegistered = false
  /** When she first dropped below vehicle speed. 0 means she is moving. */
  @Volatile private var slowSince = 0L

  /**
   * Location only. The accelerometer is NOT registered here.
   *
   * A 50 Hz sensor running for every Voice SOS user for every hour the service
   * is up is a battery cost most of them would never get anything back for,
   * because they are not in a vehicle. Since the gate already needs speed, the
   * speed can also decide when the fast sensor is worth running at all. See
   * armAccelerometer.
   */
  fun start() {
    if (started) return
    startLocation()
    started = true
    Log.i(TAG, "crash detector running, shadow=$shadowMode")
    onEvent("crash_detector_start shadow=$shadowMode")
  }

  private fun startLocation() {
    val manager = lm ?: return
    try {
      // GPS only. The network provider reports a speed interpolated from cell
      // positions and is not trustworthy for a gate this important.
      if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
        onEvent("crash_detector_gps_off_at_start")
        return
      }
      // The Looper is explicit and load-bearing. start() is called from the
      // audio thread, which has no Looper of its own, and the overload without
      // this argument builds a Handler on the calling thread and throws there.
      manager.requestLocationUpdates(
        LocationManager.GPS_PROVIDER,
        LOCATION_INTERVAL_MS,
        LOCATION_MIN_DISTANCE_M,
        this,
        Looper.getMainLooper(),
      )
    } catch (e: SecurityException) {
      // No location permission. The detector stays inert rather than guessing.
      Log.w(TAG, "no location permission, crash detection inert", e)
      onEvent("crash_detector_no_location_permission")
    } catch (e: Exception) {
      Log.w(TAG, "location updates failed", e)
    }
  }

  /**
   * Turn the fast accelerometer on while she is moving and off when she is not.
   *
   * Unregistering cannot simply follow the speed down, because a crash IS the
   * speed going to zero. Drop the sensor the instant she stops and the samples
   * that would confirm stage two never arrive, so the detector would switch
   * itself off at precisely the moment it mattered. It stays on until she has
   * been slow for longer than the collapse window can possibly need.
   */
  private fun armAccelerometer(on: Boolean) {
    val manager = sm ?: return
    if (on == accelRegistered) return
    try {
      if (on) {
        val accel = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) ?: return
        // GAME, about 50 Hz. A collision spike at the phone lasts tens of
        // milliseconds and SENSOR_DELAY_NORMAL at ~5 Hz walks straight past it.
        manager.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
        accelRegistered = true
        onEvent("crash_accel_armed")
      } else {
        manager.unregisterListener(this)
        accelRegistered = false
        onEvent("crash_accel_disarmed")
      }
    } catch (e: Exception) {
      Log.w(TAG, "accelerometer arm=$on failed", e)
    }
  }

  fun stop() {
    try { sm?.unregisterListener(this) } catch (e: Exception) { Log.w(TAG, "unregister failed", e) }
    try { lm?.removeUpdates(this) } catch (e: Exception) { Log.w(TAG, "removeUpdates failed", e) }
    accelRegistered = false
    started = false
  }

  // ── location ───────────────────────────────────────────────────────────────

  override fun onLocationChanged(location: Location) {
    // hasSpeed() is false on some devices and on mock providers. An absent
    // speed reads as -1, which fails the fix test, so the detector goes inert
    // rather than assuming she is stationary or assuming she is driving.
    val ms = if (location.hasSpeed()) location.speed.toDouble() else -1.0
    val now = System.currentTimeMillis()
    pattern.onSpeed(ms, now)

    if (ms >= CrashPattern.ARM_SPEED_MS) {
      slowSince = 0L
      armAccelerometer(true)
      return
    }
    // Below vehicle speed, or no usable speed at all. Hold the sensor open long
    // enough for a collapse to be confirmed before standing down.
    if (slowSince == 0L) slowSince = now
    if (accelRegistered && now - slowSince > ACCEL_HOLD_MS) armAccelerometer(false)
  }

  @Deprecated("Required on API < 30")
  override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
  override fun onProviderEnabled(provider: String) = Unit
  override fun onProviderDisabled(provider: String) {
    onEvent("crash_detector_gps_disabled")
  }

  // ── accelerometer ──────────────────────────────────────────────────────────

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent?) {
    val e = event ?: return
    if (e.sensor.type != Sensor.TYPE_ACCELEROMETER) return
    val x = e.values.getOrElse(0) { 0f }.toDouble()
    val y = e.values.getOrElse(1) { 0f }.toDouble()
    val z = e.values.getOrElse(2) { 0f }.toDouble()
    val net = abs(sqrt(x * x + y * y + z * z) - SensorManager.GRAVITY_EARTH)
    val now = System.currentTimeMillis()

    val reject = try {
      pattern.feed(net, now)
    } catch (ex: Exception) {
      Log.w(TAG, "pattern threw", ex)
      return
    }

    if (reject == null) {
      Log.i(TAG, "crash signature matched: ${pattern.describe()}")
      onEvent("crash_matched ${pattern.describe()} shadow=$shadowMode")
      if (shadowMode) return
      try {
        onCrash()
      } catch (ex: Exception) {
        Log.w(TAG, "onCrash threw", ex)
      }
      return
    }

    // Log the interesting rejections only. NOT_MOVING and BELOW_IMPACT fire
    // fifty times a second and would drown the log in nothing happening.
    if (reject in LOUD_REJECTS && now - lastImpactLoggedAt > 2_000L) {
      lastImpactLoggedAt = now
      onEvent("crash_rejected=$reject ${pattern.describe()}")
    }
  }
}
