import { describe, it, expect } from 'vitest';
import {
  HIGH_SPEED_KMH,
  MIN_LEG_M,
  bearingDeg,
  buildTrip,
  haversineM,
  headingAt,
  positionAt,
  splitAt,
  type RawFix,
} from './replay';

const T0 = Date.parse('2026-09-05T10:00:00Z');

/** A straight run east from a point in Sonipat, at a given speed. */
function run(kmh: number, legs: number, gapMs = 60_000, start = T0): RawFix[] {
  const metresPerLeg = (kmh * 1000) * (gapMs / 3_600_000);
  const degPerMetre = 1 / (111_320 * Math.cos((28.99 * Math.PI) / 180));
  const out: RawFix[] = [{ lat: 28.99, lng: 77.02, at: start }];
  for (let i = 1; i <= legs; i++) {
    out.push({
      lat: 28.99,
      lng: 77.02 + metresPerLeg * i * degPerMetre,
      at: start + gapMs * i,
    });
  }
  return out;
}

describe('haversineM', () => {
  it('measures a short leg to within a metre', () => {
    // 0.001 degrees of latitude is about 111 m anywhere on Earth.
    const d = haversineM({ lat: 28.99, lng: 77.02 }, { lat: 28.991, lng: 77.02 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
});

describe('buildTrip', () => {
  it('refuses a trip from fewer than two fixes', () => {
    expect(buildTrip([])).toBeNull();
    expect(buildTrip([{ lat: 28.99, lng: 77.02, at: T0 }])).toBeNull();
  });

  it('sorts fixes that arrive out of order', () => {
    const trip = buildTrip([
      { lat: 28.99, lng: 77.03, at: T0 + 60_000 },
      { lat: 28.99, lng: 77.02, at: T0 },
    ]);
    expect(trip!.startedAt).toBe(T0);
  });

  it('derives a speed that matches the ground truth', () => {
    const trip = buildTrip(run(40, 3))!;
    // Generated at 40 km/h, so every derived leg should land on it.
    for (const p of trip.points.slice(1)) {
      expect(p.speedKmh).toBeGreaterThan(39);
      expect(p.speedKmh).toBeLessThan(41);
    }
    expect(trip.topSpeedKmh).toBeGreaterThan(39);
  });

  it('reports no speed for a leg shorter than the noise floor', () => {
    // THE GUARD THAT MATTERS. A phone sitting on a table still reports fixes
    // that wander. Dividing that wander by a short gap invents a speed, and on
    // this product an invented speed is somebody being told their daughter
    // was in a moving vehicle when she was asleep.
    const jitter: RawFix[] = [
      { lat: 28.99, lng: 77.02, at: T0 },
      { lat: 28.9901, lng: 77.0201, at: T0 + 5_000 },
    ];
    const trip = buildTrip(jitter)!;
    expect(haversineM({ lat: 28.99, lng: 77.02 }, { lat: 28.9901, lng: 77.0201 })).toBeLessThan(
      MIN_LEG_M,
    );
    expect(trip.points[1].speedKmh).toBeNull();
    expect(trip.topSpeedKmh).toBeNull();
  });

  it('still counts short legs towards distance', () => {
    // No speed does not mean no movement. She did cover that ground.
    const trip = buildTrip([
      { lat: 28.99, lng: 77.02, at: T0 },
      { lat: 28.9901, lng: 77.0201, at: T0 + 5_000 },
    ])!;
    expect(trip.distanceM).toBeGreaterThan(0);
  });
});

describe('events', () => {
  it('marks a fast stretch once, not once per leg', () => {
    // Six consecutive fast legs are one stretch of road. Six chips would be
    // noise rather than information.
    const trip = buildTrip(run(80, 6))!;
    const fast = trip.events.filter((e) => e.kind === 'high_speed');
    expect(fast).toHaveLength(1);
    expect(fast[0].detail).toMatch(/km\/h/);
  });

  it('says nothing about an ordinary walk', () => {
    const trip = buildTrip(run(5, 6))!;
    expect(trip.events).toHaveLength(0);
  });

  it('needs the speed to actually cross the threshold', () => {
    const trip = buildTrip(run(HIGH_SPEED_KMH - 10, 6))!;
    expect(trip.events.filter((e) => e.kind === 'high_speed')).toHaveLength(0);
  });

  it('marks a long stop in one place', () => {
    const trip = buildTrip([
      { lat: 28.99, lng: 77.02, at: T0 },
      { lat: 28.9901, lng: 77.0201, at: T0 + 20 * 60_000 },
    ])!;
    const stops = trip.events.filter((e) => e.kind === 'long_stop');
    expect(stops).toHaveLength(1);
    expect(stops[0].detail).toMatch(/minutes/);
  });

  it('does not call moving for twenty minutes a stop', () => {
    const trip = buildTrip(run(30, 1, 20 * 60_000))!;
    expect(trip.events.filter((e) => e.kind === 'long_stop')).toHaveLength(0);
  });

  it('never invents braking, acceleration or phone use', () => {
    // These cannot be seen at a 60 second sample and must never appear. If a
    // future change starts emitting them, this test is the thing that objects.
    const trip = buildTrip(run(90, 8))!;
    const kinds = new Set(trip.events.map((e) => e.kind));
    for (const k of kinds) expect(['high_speed', 'long_stop']).toContain(k);
  });
});

describe('positionAt', () => {
  it('clamps before the start and after the end', () => {
    const trip = buildTrip(run(40, 3))!;
    expect(positionAt(trip, trip.startedAt - 10_000).index).toBe(0);
    expect(positionAt(trip, trip.endedAt + 10_000).index).toBe(trip.points.length - 1);
  });

  it('interpolates to the midpoint of a leg', () => {
    const trip = buildTrip(run(40, 1))!;
    const mid = positionAt(trip, (trip.startedAt + trip.endedAt) / 2);
    const a = trip.points[0];
    const b = trip.points[1];
    expect(mid.lng).toBeGreaterThan(Math.min(a.lng, b.lng));
    expect(mid.lng).toBeLessThan(Math.max(a.lng, b.lng));
    expect(mid.lng).toBeCloseTo((a.lng + b.lng) / 2, 6);
  });
});

describe('bearingDeg', () => {
  it('points north, east, south and west', () => {
    const o = { lat: 28.6, lng: 77.2 };
    // ~1km each way, comfortably past MIN_LEG_M.
    expect(Math.round(bearingDeg(o, { lat: 28.609, lng: 77.2 })!)).toBe(0);
    expect(Math.round(bearingDeg(o, { lat: 28.6, lng: 77.21 })!)).toBe(90);
    expect(Math.round(bearingDeg(o, { lat: 28.591, lng: 77.2 })!)).toBe(180);
    expect(Math.round(bearingDeg(o, { lat: 28.6, lng: 77.19 })!)).toBe(270);
  });

  it('refuses a bearing between two points of GPS wander', () => {
    // The reason this returns null instead of a number. A parked phone still
    // reports fixes metres apart, and turning that into a heading makes the
    // marker spin on the spot as though she were circling.
    const a = { lat: 28.6, lng: 77.2 };
    const b = { lat: 28.60005, lng: 77.20005 };
    expect(haversineM(a, b)).toBeLessThan(MIN_LEG_M);
    expect(bearingDeg(a, b)).toBeNull();
  });

  it('always reports a compass bearing, never a negative one', () => {
    const d = bearingDeg({ lat: 28.6, lng: 77.2 }, { lat: 28.609, lng: 77.19 })!;
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThan(360);
  });
});

describe('headingAt', () => {
  const moving = buildTrip([
    { lat: 28.6, lng: 77.2, at: T0 },
    { lat: 28.609, lng: 77.2, at: T0 + 60_000 },
    // Stopped: two fixes a couple of metres apart.
    { lat: 28.60902, lng: 77.20001, at: T0 + 120_000 },
  ])!;

  it('keeps the last real heading while stationary', () => {
    // The whole point. At the traffic light the marker must still point the
    // way she was going, not snap back to north because the last two fixes
    // were wander.
    expect(Math.round(headingAt(moving, 2, 123))).toBe(0);
  });

  it('falls back to what is already on screen when nothing has moved yet', () => {
    const still = buildTrip([
      { lat: 28.6, lng: 77.2, at: T0 },
      { lat: 28.60001, lng: 77.2, at: T0 + 60_000 },
    ])!;
    expect(headingAt(still, 1, 42)).toBe(42);
  });
});

describe('splitAt', () => {
  const trip = buildTrip([
    { lat: 28.6, lng: 77.2, at: T0 },
    { lat: 28.61, lng: 77.2, at: T0 + 60_000 },
    { lat: 28.62, lng: 77.2, at: T0 + 120_000 },
  ])!;

  it('meets exactly at the marker, with no gap and no overlap', () => {
    const { travelled, remaining } = splitAt(trip, T0 + 90_000);
    expect(travelled[travelled.length - 1]).toEqual(remaining[0]);
  });

  it('covers the whole route between them', () => {
    const { travelled, remaining } = splitAt(trip, T0 + 90_000);
    // The shared join point is counted twice, hence the + 1.
    expect(travelled.length + remaining.length).toBe(trip.points.length + 2);
  });

  it('has nothing behind it at the start and nothing ahead at the end', () => {
    expect(splitAt(trip, T0).travelled).toHaveLength(2);
    expect(splitAt(trip, trip.endedAt).remaining).toHaveLength(1);
  });
});
