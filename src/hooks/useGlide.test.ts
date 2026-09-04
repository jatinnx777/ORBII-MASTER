import { describe, it, expect } from 'vitest';
import { GLIDE_MS, SNAP_DEG, easeOutCubic, shouldSnap } from './useGlide';

describe('easeOutCubic', () => {
  it('is anchored at both ends', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('front-loads the movement', () => {
    // Ease-out, never ease-in. Most of the travel happens early, so the marker
    // sets off the instant the fix lands rather than hesitating first.
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });

  it('never goes backwards', () => {
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('shouldSnap', () => {
  const at = { lat: 28.99, lng: 77.02 };

  it('snaps GPS wander instead of animating it', () => {
    // A phone on a table reports fixes that move a couple of metres. Gliding
    // that would keep the frame timer alive forever to render drift as travel.
    expect(shouldSnap(at, { lat: at.lat + SNAP_DEG / 2, lng: at.lng })).toBe(true);
  });

  it('glides a real move', () => {
    // Roughly 100 m north.
    expect(shouldSnap(at, { lat: at.lat + 0.0009, lng: at.lng })).toBe(false);
  });

  it('checks both axes, not just latitude', () => {
    expect(shouldSnap(at, { lat: at.lat, lng: at.lng + 0.0009 })).toBe(false);
  });
});

describe('GLIDE_MS', () => {
  it('is shorter than the gap between fixes', () => {
    // Fixes land every 60 seconds. A glide longer than that would still be
    // travelling when the next one arrived, and the marker would never settle.
    expect(GLIDE_MS).toBeLessThan(60_000);
  });
});
