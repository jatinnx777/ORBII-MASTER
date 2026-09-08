import { describe, it, expect } from 'vitest';
import {
  ago,
  describeLocation,
  formatDistance,
  haversineM,
  } from './format';
import type { MemberLocation } from '../services/locations';

/**
 * These are the sentences somebody reads while deciding whether to get in a
 * car, so the priority order between them is the whole point and it is not
 * visible in a type check. Every one of these tests is a wrong answer that
 * would send a person to the wrong place or leave them at home.
 */

const base: MemberLocation = {
  userId: 'u1',
  name: 'Aditi',
  photoUri: null,
  lat: 28.6139,
  lng: 77.209,
  updatedAt: new Date().toISOString(),
  battery: 60,
  charging: false,
  speedKmh: null,
  accuracyM: 12,
  sharing: true,
  emergency: false,
  ageSeconds: 30,
  unreachable: false,
  precisionM: null,
};

describe('describeLocation priority', () => {
  it('says emergency above everything else', () => {
    // An SOS row can also be stale and not sharing, because the override in
    // sql/118 releases it regardless of both. If either of those won, the one
    // screen that exists for emergencies would describe one as "location off".
    const m = { ...base, emergency: true, sharing: false, unreachable: true, ageSeconds: 4000 };
    expect(describeLocation(m).text).toMatch(/^Live, during the emergency/);
    expect(describeLocation(m).loud).toBe(true);
  });

  it('says not updating above location off', () => {
    const m = { ...base, unreachable: true, ageSeconds: 1500 };
    expect(describeLocation(m).text).toMatch(/^Not updating/);
    expect(describeLocation(m).loud).toBe(true);
  });

  it('names an approximate position instead of pretending it is a point', () => {
    // The failure this prevents: a bubbled pin renders identically to an exact
    // one, so without the word "approximate" somebody drives to the centre of
    // a cell she is not standing in.
    const m = { ...base, precisionM: 2000 };
    expect(describeLocation(m).text).toContain('Approximate, within 2.0 km');
  });

  it('gives a metres radius under a kilometre', () => {
    expect(describeLocation({ ...base, precisionM: 500 }).text).toContain('within 500 m');
  });

  it('is quiet when nothing is wrong', () => {
    expect(describeLocation(base).loud).toBe(false);
  });
});

describe('ago', () => {
  it('never says a number under a minute', () => {
    // "0m ago" reads as broken. Under a minute the honest word is "just now".
    expect(ago(0)).toBe('just now');
    expect(ago(59)).toBe('just now');
  });

  it('steps through minutes, hours and days', () => {
    expect(ago(120)).toBe('2m ago');
    expect(ago(7200)).toBe('2h ago');
    expect(ago(172800)).toBe('2d ago');
  });
});

describe('haversineM', () => {
  it('is zero for the same point', () => {
    expect(haversineM({ lat: 28.6, lng: 77.2 }, { lat: 28.6, lng: 77.2 })).toBe(0);
  });

  it('measures a known distance to within a percent', () => {
    // India Gate to Red Fort, about 5.6km apart in a straight line.
    const d = haversineM({ lat: 28.6129, lng: 77.2295 }, { lat: 28.6562, lng: 77.241 });
    expect(d).toBeGreaterThan(4600);
    expect(d).toBeLessThan(5400);
  });

  it('is symmetric', () => {
    const a = { lat: 28.6, lng: 77.2 };
    const b = { lat: 19.076, lng: 72.877 };
    expect(haversineM(a, b)).toBeCloseTo(haversineM(b, a), 6);
  });
});

describe('formatDistance', () => {
  it('uses metres below a kilometre and kilometres above', () => {
    expect(formatDistance(340)).toBe('340 m away');
    expect(formatDistance(2400)).toBe('2.4 km away');
  });

  it('does not round a short distance up to a kilometre', () => {
    // 999m as "1.0 km away" reads as further than it is, and this screen is
    // read by somebody deciding whether to walk.
    expect(formatDistance(999)).toBe('999 m away');
  });
});
