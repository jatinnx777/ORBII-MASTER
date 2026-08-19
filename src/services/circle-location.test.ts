import { describe, expect, it } from 'vitest';
import { buildDayTimeline, detectStops, dwellMinutes, formatDuration } from './circle-location';
import type { TrailPoint } from './circle-location';

// Trails arrive NEWEST FIRST, as loadMemberTrail returns them. Getting that
// backwards silently inverts every duration, so the fixtures below build in
// that order deliberately rather than reversing at the end.
const BASE = Date.parse('2026-08-19T09:00:00+05:30');
const at = (minsAfterBase: number) => new Date(BASE + minsAfterBase * 60_000).toISOString();

/** `mins` ascending; returned newest-first to match the real data shape. */
function trail(points: { lat: number; lng: number; mins: number }[]): TrailPoint[] {
  return points
    .map((p) => ({ lat: p.lat, lng: p.lng, at: at(p.mins) }))
    .reverse();
}

// Roughly 1 km apart at Delhi's latitude; far enough to be a separate place.
const A = { lat: 28.6139, lng: 77.209 };
const B = { lat: 28.6229, lng: 77.209 };

describe('detectStops', () => {
  it('finds nothing in a trail too short to mean anything', () => {
    expect(detectStops([])).toEqual([]);
    expect(detectStops(trail([{ ...A, mins: 0 }]))).toEqual([]);
  });

  it('ignores a pause shorter than the minimum', () => {
    // Three minutes in one spot is a traffic light, not a stop.
    const t = trail([
      { ...A, mins: 0 },
      { ...A, mins: 1 },
      { ...A, mins: 3 },
    ]);
    expect(detectStops(t)).toEqual([]);
  });

  it('finds a real stop and reports how long it lasted', () => {
    const t = trail([
      { ...A, mins: 0 },
      { ...A, mins: 10 },
      { ...A, mins: 25 },
    ]);
    const stops = detectStops(t);
    expect(stops).toHaveLength(1);
    expect(stops[0].minutes).toBe(25);
  });

  it('separates two places rather than merging them', () => {
    const t = trail([
      { ...A, mins: 0 },
      { ...A, mins: 20 },
      { ...B, mins: 40 },
      { ...B, mins: 70 },
    ]);
    expect(detectStops(t)).toHaveLength(2);
  });

  it('treats small GPS jitter as one place, not many', () => {
    // ~10 m of drift while standing still must not become several stops.
    const t = trail([
      { lat: 28.6139, lng: 77.209, mins: 0 },
      { lat: 28.61391, lng: 77.20902, mins: 8 },
      { lat: 28.61389, lng: 77.20898, mins: 16 },
      { lat: 28.6139, lng: 77.20901, mins: 24 },
    ]);
    expect(detectStops(t)).toHaveLength(1);
  });
});

describe('dwellMinutes', () => {
  it('is null when there is nothing to measure', () => {
    expect(dwellMinutes([])).toBeNull();
    expect(dwellMinutes(trail([{ ...A, mins: 0 }]))).toBeNull();
  });

  it('reports how long they have been where they are NOW', () => {
    const t = trail([
      { ...B, mins: 0 },
      { ...A, mins: 10 },
      { ...A, mins: 40 },
    ]);
    // Newest point is A at +40; they have been at A since +10.
    expect(dwellMinutes(t)).toBe(30);
  });

  it('is null when they have only just arrived', () => {
    const t = trail([
      { ...B, mins: 0 },
      { ...A, mins: 29 },
      { ...A, mins: 31 },
    ]);
    expect(dwellMinutes(t)).toBeNull();
  });
});

describe('buildDayTimeline', () => {
  it('reads oldest first, the way a day is lived', () => {
    const t = trail([
      { ...A, mins: 0 },
      { ...A, mins: 30 },
      { ...B, mins: 60 },
      { ...B, mins: 90 },
    ]);
    const line = buildDayTimeline(t);
    const stops = line.filter((e) => e.kind === 'stop');
    expect(stops).toHaveLength(2);
    expect(Date.parse(stops[0].from)).toBeLessThan(Date.parse(stops[1].from));
  });

  it('puts a journey between two places', () => {
    const t = trail([
      { ...A, mins: 0 },
      { ...A, mins: 30 },
      { ...B, mins: 60 },
      { ...B, mins: 90 },
    ]);
    const moves = buildDayTimeline(t).filter((e) => e.kind === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0].kind === 'move' && moves[0].metres).toBeGreaterThan(500);
  });

  it('does not invent a trip out of GPS drift', () => {
    // Two "stops" a few metres apart are the same room, not a journey. Legs
    // under 200 m are dropped precisely so the timeline does not fill with
    // imaginary walks around a building.
    const t = trail([
      { lat: 28.6139, lng: 77.209, mins: 0 },
      { lat: 28.6139, lng: 77.209, mins: 30 },
      { lat: 28.61395, lng: 77.20905, mins: 60 },
      { lat: 28.61395, lng: 77.20905, mins: 90 },
    ]);
    expect(buildDayTimeline(t).filter((e) => e.kind === 'move')).toHaveLength(0);
  });

  it('is empty when nobody stopped anywhere', () => {
    expect(buildDayTimeline([])).toEqual([]);
  });
});

describe('formatDuration', () => {
  it('reads the way a person would say it', () => {
    expect(formatDuration(5)).toMatch(/5/);
    expect(formatDuration(90)).toMatch(/1/);
  });
});
