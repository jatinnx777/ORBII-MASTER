import { Accelerometer } from 'expo-sensors';
import type { Subscription } from 'expo-sensors/build/DeviceSensor';

/**
 * Impact and unresponsiveness detection.
 *
 * A hard impact followed by stillness is what a fall down a stairwell, a road
 * accident, or an assault that ends with her on the ground looks like to an
 * accelerometer. If she cannot reach the button, the phone notices for her.
 *
 * THE HARD PART IS NOT DETECTING THE IMPACT, IT IS NOT CRYING WOLF.
 *
 * A phone dropped on a desk clears 3.8 g easily and then lies perfectly still.
 * A naive "impact then stillness" detector fires an SOS every time somebody puts
 * their phone down hard. That is not a cosmetic bug on this product: it sends
 * strangers to her address, wastes the responder pool, and after the second false
 * alarm she turns the feature off and it protects nobody.
 *
 * Four guards, in the order they reject:
 *
 *   1. MOTION BEFORE THE IMPACT. A person who falls was moving first: walking,
 *      running, being pushed. A phone knocked off a table was sitting still.
 *      This single test removes most desk drops and costs one rolling window.
 *   2. STILLNESS AFTER, CONTINUOUSLY. Any real movement during the watch window
 *      aborts. Somebody who gets back up is fine, and the absence of that is the
 *      actual signal.
 *   3. COOLDOWN. One candidate per cooldown period, so a tumbling phone
 *      generating several impacts cannot queue several triggers.
 *   4. THE HUMAN. onTrigger must not fire an SOS. It must open the existing
 *      cancelable countdown, which is the only guard that is never wrong,
 *      because she can answer it.
 *
 * The detector is a pure state machine over magnitudes so it can be tested
 * without a device. Everything sensor-shaped lives in initVolumetricMonitor.
 */

/** 20 Hz. Fast enough to catch a 50 ms impact spike, cheap on battery. */
export const SAMPLE_HZ = 20;
export const SAMPLE_INTERVAL_MS = Math.round(1000 / SAMPLE_HZ);

/**
 * Impact threshold in g.
 *
 * Free-fall onto a hard floor from waist height lands between 4 and 10 g. Normal
 * handling, pocketing a phone, jogging, a car over a speed bump, sits under 3 g.
 * 3.8 is above ordinary life and below a real fall.
 */
export const IMPACT_G = 3.8;

/** How long she must stay still afterwards before we treat it as unresponsive. */
export const STILLNESS_WINDOW_MS = 4000;

/**
 * Deviation from 1 g that still counts as "not moving", in g.
 *
 * Not zero, deliberately. A phone against a body picks up breathing and small
 * involuntary movement, and demanding absolute stillness would mean the only
 * thing that reliably passes is a phone lying on concrete.
 */
export const STILLNESS_TOLERANCE_G = 0.18;

/** Window before the impact that is examined for movement. */
export const PRE_IMPACT_WINDOW_MS = 1500;

/**
 * Movement required in that window, as standard deviation of magnitude in g.
 *
 * A phone at rest on a table sits near 0.01. Walking with it in a pocket or a
 * bag is 0.15 and up. 0.08 sits between the two with room on both sides.
 */
export const PRE_IMPACT_MOTION_G = 0.08;

/** No second candidate inside this window. */
export const COOLDOWN_MS = 30_000;

export type ShockEvent =
  | { type: 'impact'; magnitudeG: number; at: number }
  | { type: 'aborted'; reason: 'movement_resumed'; at: number }
  | { type: 'rejected'; reason: 'no_motion_before_impact' | 'cooling_down'; at: number }
  | { type: 'unresponsive'; magnitudeG: number; at: number };

type Sample = { m: number; t: number };

/**
 * Pure detector. Feed it magnitudes, it returns events.
 *
 * No timers of its own: it advances only when a sample arrives, so a stalled
 * sensor can never produce a trigger from nothing. That matters, because the
 * failure it would otherwise have is firing an SOS because the accelerometer
 * went quiet, which is the opposite of what silence means here.
 */
export class ShockDetector {
  private ring: Sample[] = [];
  private watching: { since: number; impactG: number } | null = null;
  /**
   * Null, not 0.
   *
   * Zero means "a trigger happened at time 0", so with any clock whose origin is
   * near zero (a monotonic clock, a test clock, performance.now) the cooldown
   * test `at - lastTriggerAt < COOLDOWN_MS` is true and the detector is DEAD for
   * its first 30 seconds. It happens to work with Date.now only because that
   * number is enormous. Null says "never triggered" and is correct under every
   * clock.
   */
  private lastTriggerAt: number | null = null;
  private ringMs: number;

  constructor(private readonly now: () => number = Date.now) {
    this.ringMs = PRE_IMPACT_WINDOW_MS + 500;
  }

  /** Standard deviation of magnitude over the retained window, in g. */
  private motionStdDev(upToT: number, windowMs: number): number {
    const from = upToT - windowMs;
    const vals: number[] = [];
    for (const s of this.ring) {
      if (s.t >= from && s.t < upToT) vals.push(s.m);
    }
    // Too few samples to judge. Treated as "no motion proven", which rejects.
    // Failing closed here means a fall in the first second after arming is
    // missed; failing open would mean every desk drop at startup fires.
    if (vals.length < 5) return 0;

    let sum = 0;
    for (const v of vals) sum += v;
    const mean = sum / vals.length;

    let sq = 0;
    for (const v of vals) sq += (v - mean) * (v - mean);
    return Math.sqrt(sq / vals.length);
  }

  /**
   * Push one magnitude in g. Returns an event, or null when nothing changed.
   *
   * `at` is injectable so tests can drive time deterministically rather than
   * sleeping, which is how timing tests become flaky.
   */
  push(magnitudeG: number, at: number = this.now()): ShockEvent | null {
    if (!Number.isFinite(magnitudeG) || magnitudeG < 0) return null;

    // Watching for stillness. Checked BEFORE the new sample joins the ring so a
    // violent sample cannot both abort the watch and start a new impact.
    if (this.watching) {
      const deviation = Math.abs(magnitudeG - 1);
      if (deviation > STILLNESS_TOLERANCE_G) {
        this.watching = null;
        this.record(magnitudeG, at);
        return { type: 'aborted', reason: 'movement_resumed', at };
      }

      if (at - this.watching.since >= STILLNESS_WINDOW_MS) {
        const impactG = this.watching.impactG;
        this.watching = null;
        this.lastTriggerAt = at;
        // The ring is cleared so the stillness just observed cannot be read as
        // pre-impact motion for whatever happens next.
        this.ring = [];
        return { type: 'unresponsive', magnitudeG: impactG, at };
      }

      this.record(magnitudeG, at);
      return null;
    }

    if (magnitudeG < IMPACT_G) {
      this.record(magnitudeG, at);
      return null;
    }

    // An impact. Everything below decides whether it is worth watching.
    if (this.lastTriggerAt !== null && at - this.lastTriggerAt < COOLDOWN_MS) {
      this.record(magnitudeG, at);
      return { type: 'rejected', reason: 'cooling_down', at };
    }

    const motion = this.motionStdDev(at, PRE_IMPACT_WINDOW_MS);
    this.record(magnitudeG, at);

    if (motion < PRE_IMPACT_MOTION_G) {
      // Still before the bang: a phone put down hard, a bag dropped, a door
      // slammed next to a phone on a shelf. Nobody fell.
      return { type: 'rejected', reason: 'no_motion_before_impact', at };
    }

    this.watching = { since: at, impactG: magnitudeG };
    return { type: 'impact', magnitudeG, at };
  }

  private record(m: number, t: number): void {
    this.ring.push({ m, t });
    const cutoff = t - this.ringMs;
    while (this.ring.length > 0 && this.ring[0].t < cutoff) this.ring.shift();
  }

  /** True while an impact is being watched for follow-up stillness. */
  isWatching(): boolean {
    return this.watching !== null;
  }

  reset(): void {
    this.ring = [];
    this.watching = null;
    this.lastTriggerAt = null;
  }
}

export type VolumetricMonitorOptions = {
  /**
   * Called on every event, not only a trigger. Useful for logging why a
   * candidate was rejected, which is the only way to tune the thresholds
   * against real phones instead of guesses.
   */
  onEvent?: (event: ShockEvent) => void;
};

export type VolumetricMonitorHandle = {
  /** Idempotent. Safe to call from a React cleanup that may run twice. */
  stop: () => void;
  /** False when the device has no accelerometer, or the subscription failed. */
  active: boolean;
};

/**
 * Start monitoring. Returns a handle whose stop() is the cleanup.
 *
 * onTrigger MUST NOT FIRE AN SOS DIRECTLY. Hand it to the existing cancelable
 * countdown. No accelerometer heuristic is ever certain, and the countdown is
 * the one check that cannot be wrong, because the person answers it. Firing
 * straight through would put strangers at her door because she dropped a bag.
 */
export function initVolumetricMonitor(
  onTrigger: () => void,
  options: VolumetricMonitorOptions = {},
): VolumetricMonitorHandle {
  const detector = new ShockDetector();
  let sub: Subscription | null = null;
  let stopped = false;

  const handle: VolumetricMonitorHandle = {
    active: false,
    stop: () => {
      if (stopped) return;
      stopped = true;
      handle.active = false;
      try {
        sub?.remove();
      } catch (err) {
        console.warn('[volumetricShock] could not remove subscription', err);
      }
      sub = null;
      detector.reset();
    },
  };

  try {
    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);

    sub = Accelerometer.addListener(({ x, y, z }) => {
      if (stopped) return;
      const magnitude = Math.sqrt(x * x + y * y + z * z);

      let event: ShockEvent | null = null;
      try {
        event = detector.push(magnitude);
      } catch (err) {
        // A detector bug must not kill the sensor subscription. Losing the
        // listener silently would mean the feature reports itself as active
        // while detecting nothing at all.
        console.warn('[volumetricShock] detector threw', err);
        return;
      }

      if (!event) return;

      try {
        options.onEvent?.(event);
      } catch (err) {
        console.warn('[volumetricShock] onEvent threw', err);
      }

      if (event.type === 'unresponsive') {
        try {
          onTrigger();
        } catch (err) {
          console.warn('[volumetricShock] onTrigger threw', err);
        }
      }
    });

    handle.active = true;
  } catch (err) {
    // No accelerometer, or the sensor is unavailable. Reported through `active`
    // rather than thrown, so a caller can tell the user the feature is off on
    // this device instead of showing it as armed.
    console.warn('[volumetricShock] could not start monitor', err);
    handle.active = false;
  }

  return handle;
}

/** Does this device have an accelerometer? Safe to call any time. */
export async function isImpactDetectionAvailable(): Promise<boolean> {
  try {
    return await Accelerometer.isAvailableAsync();
  } catch {
    return false;
  }
}
