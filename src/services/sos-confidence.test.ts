import { describe, it, expect } from 'vitest';
import {
  BASE_SECONDS,
  CEILING_SECONDS,
  FLOOR_SECONDS,
  classifyMotion,
  resolveCountdown,
} from './sos-confidence';

// A phone at rest reads 1 g and hardly moves. These generators produce the
// three cases the classifier has to tell apart, without needing a device.
function still(n = 16): number[] {
  return Array.from({ length: n }, (_, i) => 1 + (i % 2 === 0 ? 0.004 : -0.004));
}
function held(n = 16): number[] {
  return Array.from({ length: n }, (_, i) => 1 + Math.sin(i) * 0.09);
}
function violent(n = 16): number[] {
  return Array.from({ length: n }, (_, i) => 1 + Math.sin(i * 3) * 0.9);
}

describe('classifyMotion', () => {
  it('calls a phone lying untouched still', () => {
    expect(classifyMotion(still())).toBe('still');
  });

  it('does not call a hand-held phone still', () => {
    // The whole feature turns on this. Human tremor is an order of magnitude
    // above sensor noise, so a phone she is holding must never be mistaken for
    // one on a table, or a real SOS gets the longest window.
    expect(classifyMotion(held())).toBe('ordinary');
  });

  it('calls a phone being thrown around violent', () => {
    expect(classifyMotion(violent())).toBe('violent');
  });

  it('says unknown rather than guessing from too few samples', () => {
    expect(classifyMotion([1, 1, 1])).toBe('unknown');
    expect(classifyMotion([])).toBe('unknown');
  });

  it('does not call an ordinary walk violent', () => {
    // A phone in a pocket while she walks must read as ordinary. If walking
    // scored as violent, every voice trigger on the street would get the
    // SHORTEST window, which is the opposite of what this is for.
    const walking = Array.from(
      { length: 24 },
      (_, i) => 1 + Math.sin(i * 0.8) * 0.22,
    );
    expect(classifyMotion(walking)).toBe('ordinary');
  });
});

describe('resolveCountdown', () => {
  const base = { source: 'voice' as const, cancelRate: null, historySize: 0 };

  it('leaves a pressed button alone', () => {
    // A button press is already a decision. Nothing here may second-guess it.
    const p = resolveCountdown({
      source: 'button',
      motion: 'still',
      cancelRate: 0.9,
      historySize: 10,
    });
    expect(p.seconds).toBe(BASE_SECONDS);
    expect(p.level).toBe('normal');
  });

  it('gives the default when it knows nothing', () => {
    const p = resolveCountdown({ ...base, motion: 'unknown' });
    expect(p.seconds).toBe(BASE_SECONDS);
    expect(p.reasons).toContain('no_motion_data');
  });

  it('lengthens the window for a phone nobody is holding', () => {
    const p = resolveCountdown({ ...base, motion: 'still' });
    expect(p.seconds).toBeGreaterThan(BASE_SECONDS);
    expect(p.level).toBe('low');
  });

  it('shortens the window when the phone is being fought over', () => {
    const p = resolveCountdown({ ...base, motion: 'violent' });
    expect(p.seconds).toBeLessThan(BASE_SECONDS);
    expect(p.level).toBe('high');
  });

  it('lengthens the window for a user who cancels half their triggers', () => {
    const p = resolveCountdown({
      source: 'voice',
      motion: 'ordinary',
      cancelRate: 0.6,
      historySize: 10,
    });
    expect(p.seconds).toBeGreaterThan(BASE_SECONDS);
    expect(p.reasons).toContain('cancel_prone');
  });

  it('ignores a cancel rate drawn from too little history', () => {
    // One cancel out of two is not evidence of anything, and acting on it would
    // punish a brand new user for a single mistake.
    const p = resolveCountdown({
      source: 'voice',
      motion: 'ordinary',
      cancelRate: 0.5,
      historySize: 2,
    });
    expect(p.seconds).toBe(BASE_SECONDS);
  });

  it('refuses to shorten for a user prone to false alarms', () => {
    // The signals disagree: the phone is moving hard, but this person cancels
    // most of what they trigger. The cautious side wins, because a delay is
    // recoverable and strangers sent to an address are not.
    const p = resolveCountdown({
      source: 'voice',
      motion: 'violent',
      cancelRate: 0.8,
      historySize: 10,
    });
    expect(p.seconds).toBeGreaterThanOrEqual(BASE_SECONDS);
    expect(p.level).not.toBe('high');
  });

  it('never goes outside the floor and the ceiling', () => {
    const cases: Array<Parameters<typeof resolveCountdown>[0]> = [
      { source: 'voice', motion: 'still', cancelRate: 1, historySize: 10 },
      { source: 'voice', motion: 'violent', cancelRate: 0, historySize: 10 },
      { source: 'voice', motion: 'unknown', cancelRate: null, historySize: 0 },
    ];
    for (const c of cases) {
      const p = resolveCountdown(c);
      expect(p.seconds).toBeGreaterThanOrEqual(FLOOR_SECONDS);
      expect(p.seconds).toBeLessThanOrEqual(CEILING_SECONDS);
    }
  });
});
