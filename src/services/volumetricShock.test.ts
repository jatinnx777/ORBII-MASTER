import { describe, it, expect } from 'vitest';
import {
  ShockDetector,
  IMPACT_G,
  STILLNESS_WINDOW_MS,
  COOLDOWN_MS,
  SAMPLE_INTERVAL_MS,
  type ShockEvent,
} from './volumetricShock';

/**
 * The detector is driven with synthetic magnitude streams and an injected clock,
 * so nothing here sleeps and nothing is timing-flaky.
 *
 * The tests that matter are the REJECTIONS. Detecting a 4 g spike is arithmetic.
 * Not summoning strangers because somebody put their phone down hard is the
 * thing this feature lives or dies on.
 */

type Frame = { m: number; t: number };

/** Phone at rest: 1 g plus sensor noise. */
function still(fromT: number, ms: number): Frame[] {
  const out: Frame[] = [];
  for (let t = fromT; t < fromT + ms; t += SAMPLE_INTERVAL_MS) {
    out.push({ m: 1 + (Math.sin(t / 7) * 0.01), t });
  }
  return out;
}

/** Walking with the phone on the body: a clear gait signal around 1 g. */
function walking(fromT: number, ms: number): Frame[] {
  const out: Frame[] = [];
  for (let t = fromT; t < fromT + ms; t += SAMPLE_INTERVAL_MS) {
    out.push({ m: 1 + Math.sin(t / 90) * 0.35, t });
  }
  return out;
}

function run(detector: ShockDetector, frames: Frame[]): ShockEvent[] {
  const events: ShockEvent[] = [];
  for (const f of frames) {
    const e = detector.push(f.m, f.t);
    if (e) events.push(e);
  }
  return events;
}

const types = (events: ShockEvent[]) => events.map((e) => e.type);

describe('ShockDetector, the true positive', () => {
  it('fires on walking, then impact, then four seconds down', () => {
    const d = new ShockDetector();
    const events = run(d, [
      ...walking(0, 3000),
      { m: 5.2, t: 3000 },
      ...still(3050, STILLNESS_WINDOW_MS + 500),
    ]);
    expect(types(events)).toContain('impact');
    expect(types(events)).toContain('unresponsive');
  });

  it('reports the impact magnitude, not the stillness that followed', () => {
    const d = new ShockDetector();
    const events = run(d, [
      ...walking(0, 3000),
      { m: 6.7, t: 3000 },
      ...still(3050, STILLNESS_WINDOW_MS + 500),
    ]);
    const trigger = events.find((e) => e.type === 'unresponsive');
    expect(trigger).toBeDefined();
    expect((trigger as { magnitudeG: number }).magnitudeG).toBeCloseTo(6.7, 5);
  });
});

describe('ShockDetector, the false positives that would end the feature', () => {
  it('ignores a phone put down hard on a desk', () => {
    // The signature: perfectly still, one big spike, still again. No fall.
    const d = new ShockDetector();
    const events = run(d, [
      ...still(0, 3000),
      { m: 6.0, t: 3000 },
      ...still(3050, STILLNESS_WINDOW_MS + 500),
    ]);
    expect(types(events)).not.toContain('unresponsive');
    expect(events.some((e) => e.type === 'rejected' && e.reason === 'no_motion_before_impact')).toBe(
      true,
    );
  });

  it('does not fire when she gets straight back up', () => {
    const d = new ShockDetector();
    const events = run(d, [
      ...walking(0, 3000),
      { m: 5.0, t: 3000 },
      ...still(3050, 1500),
      ...walking(4600, 2000), // moving again well inside the window
      ...still(6600, STILLNESS_WINDOW_MS + 500),
    ]);
    expect(types(events)).toContain('impact');
    expect(events.some((e) => e.type === 'aborted' && e.reason === 'movement_resumed')).toBe(true);
    expect(types(events)).not.toContain('unresponsive');
  });

  it('does not fire on stillness one sample short of the window', () => {
    const d = new ShockDetector();
    const events = run(d, [
      ...walking(0, 3000),
      { m: 5.0, t: 3000 },
      ...still(3050, STILLNESS_WINDOW_MS - 200),
    ]);
    expect(types(events)).not.toContain('unresponsive');
  });

  it('ignores ordinary handling below the impact threshold', () => {
    const d = new ShockDetector();
    const events = run(d, [
      ...walking(0, 3000),
      { m: IMPACT_G - 0.3, t: 3000 }, // jogging, a speed bump, pocketing it
      ...still(3050, STILLNESS_WINDOW_MS + 500),
    ]);
    expect(events).toHaveLength(0);
  });

  it('will not queue a second trigger inside the cooldown', () => {
    const d = new ShockDetector();
    const first = run(d, [
      ...walking(0, 3000),
      { m: 5.0, t: 3000 },
      ...still(3050, STILLNESS_WINDOW_MS + 200),
    ]);
    expect(types(first)).toContain('unresponsive');

    const t2 = 8000;
    const second = run(d, [
      ...walking(t2, 3000),
      { m: 5.0, t: t2 + 3000 },
      ...still(t2 + 3050, STILLNESS_WINDOW_MS + 200),
    ]);
    expect(types(second)).not.toContain('unresponsive');
    expect(second.some((e) => e.type === 'rejected' && e.reason === 'cooling_down')).toBe(true);
  });

  it('allows a real second event once the cooldown has passed', () => {
    const d = new ShockDetector();
    run(d, [...walking(0, 3000), { m: 5.0, t: 3000 }, ...still(3050, STILLNESS_WINDOW_MS + 200)]);

    const t2 = COOLDOWN_MS + 20_000;
    const second = run(d, [
      ...walking(t2, 3000),
      { m: 5.0, t: t2 + 3000 },
      ...still(t2 + 3050, STILLNESS_WINDOW_MS + 200),
    ]);
    expect(types(second)).toContain('unresponsive');
  });
});

describe('ShockDetector, degenerate input', () => {
  it('cannot trigger from a sensor that went silent', () => {
    // The dangerous failure: no samples must never become "she is not moving".
    //
    // This assertion used to be toBeNull(), which is what the detector returned
    // BEFORE the continuity check existed. Returning null happened to avoid a
    // trigger on this one input, but only because the window had not elapsed
    // yet; push one millisecond later and it fired. The watch is now abandoned
    // outright, which is the property the test name always claimed.
    const d = new ShockDetector();
    run(d, [...walking(0, 3000), { m: 5.0, t: 3000 }]);
    expect(d.isWatching()).toBe(true);

    const late = d.push(1.0, 3000 + STILLNESS_WINDOW_MS - 1);
    expect(late).toEqual({ type: 'aborted', reason: 'sample_gap', at: 6999 });
    expect(d.isWatching()).toBe(false);
  });

  it('does NOT fire when the sensor stops mid-watch and resumes on a still phone', () => {
    // The regression this guard exists for. Android throttles sensors in
    // background and in battery saver. Without continuity the first sample after
    // the gap satisfies a four-second window nothing observed, and strangers are
    // dispatched because she pocketed her phone after dropping a bag.
    const d = new ShockDetector();
    const events = run(d, [...walking(0, 3000), { m: 5.0, t: 3000 }]);
    expect(types(events)).toContain('impact');

    // Sensor silent for two minutes, then resumes with the phone at rest.
    const resumed = run(d, still(123_000, STILLNESS_WINDOW_MS + 1000));
    expect(types(resumed)).not.toContain('unresponsive');
    expect(resumed.some((e) => e.type === 'aborted' && e.reason === 'sample_gap')).toBe(true);
  });

  it('tolerates ordinary scheduler jitter without aborting', () => {
    // A late sample is normal on a busy phone. Aborting on every hiccup would
    // make the feature useless in exactly the moment it is needed.
    const d = new ShockDetector();
    const frames = [...walking(0, 3000), { m: 5.0, t: 3000 }];
    // Three intervals late, inside the four-interval budget.
    frames.push({ m: 1.0, t: 3000 + SAMPLE_INTERVAL_MS * 3 });
    const events = run(d, frames);
    expect(events.some((e) => e.type === 'aborted' && e.reason === 'sample_gap')).toBe(false);
    expect(d.isWatching()).toBe(true);
  });

  it('recovers cleanly after a gap and can still detect a real fall', () => {
    // Aborting must not wedge the detector. After the gap it has to work again.
    const d = new ShockDetector();
    run(d, [...walking(0, 3000), { m: 5.0, t: 3000 }]);
    run(d, still(200_000, 500)); // gap abort, watch cleared

    const t = 400_000;
    const second = run(d, [
      ...walking(t, 3000),
      { m: 5.4, t: t + 3000 },
      ...still(t + 3050, STILLNESS_WINDOW_MS + 200),
    ]);
    expect(types(second)).toContain('unresponsive');
  });

  it('does not abort on the very first sample, when there is no history', () => {
    const d = new ShockDetector();
    // lastSampleAt is 0, so a huge `at` must not be read as a gap.
    expect(d.push(1.0, 9_999_999)).toBeNull();
  });

  it('ignores NaN and negative magnitudes', () => {
    const d = new ShockDetector();
    expect(d.push(NaN, 0)).toBeNull();
    expect(d.push(-4, 10)).toBeNull();
    expect(d.isWatching()).toBe(false);
  });

  it('rejects an impact in the first moments after arming', () => {
    // Too few samples to prove motion. Failing closed is the right direction:
    // a missed fall in the first second, never a false alarm at startup.
    const d = new ShockDetector();
    const events = run(d, [{ m: 8.0, t: 0 }, ...still(50, STILLNESS_WINDOW_MS + 200)]);
    expect(types(events)).not.toContain('unresponsive');
  });

  it('reset clears a watch in progress', () => {
    const d = new ShockDetector();
    run(d, [...walking(0, 3000), { m: 5.0, t: 3000 }]);
    expect(d.isWatching()).toBe(true);
    d.reset();
    expect(d.isWatching()).toBe(false);
  });
});
