import { supabase } from './supabase';

/**
 * Trip replay: reconstructing a journey from the location trail.
 *
 * WHAT THE DATA ACTUALLY IS, because it decides most of what this file can
 * honestly claim. circle_location_history is written every 60 seconds OR every
 * 40 metres, whichever comes first (circle-location.ts), capped at 500 points,
 * and wiped at local midnight (sql/73).
 *
 * That sampling rate is the whole story:
 *
 *   DERIVABLE. Distance, duration, start and end, and an average speed between
 *   each pair of fixes. A speed here means "she covered this ground in this
 *   time", not "the speedometer read this".
 *
 *   NOT DERIVABLE, AND DELIBERATELY ABSENT. Hard braking, rapid acceleration
 *   and sudden stops are one to two second events. At a 60 second sample they
 *   are invisible, and a chip claiming one would be a guess dressed as a
 *   measurement. Phone usage is not tracked at all, anywhere in ORBII.
 *
 * So this file derives what the data supports and refuses to invent the rest.
 * The event model has room for the others: if ORBII ever samples motion at a
 * rate that can see them, they slot in without a redesign. Until then they do
 * not appear, because on this product a fabricated telemetry chip is somebody
 * deciding their daughter drives badly on the strength of a rounding error.
 */

export type DrivePoint = {
  lat: number;
  lng: number;
  /** Milliseconds since epoch. */
  at: number;
  /**
   * Average km/h covered since the previous point. Null on the first point,
   * where there is nothing to average against.
   */
  speedKmh: number | null;
  /** Metres from the start, along the path. */
  distanceM: number;
};

export type DriveEventKind = 'high_speed' | 'long_stop';

export type DriveEvent = {
  id: string;
  kind: DriveEventKind;
  /** Index into the points array, so the scrubber can snap to it exactly. */
  index: number;
  at: number;
  lat: number;
  lng: number;
  label: string;
  detail: string;
};

export type DriveTrip = {
  points: DrivePoint[];
  events: DriveEvent[];
  distanceM: number;
  durationMs: number;
  startedAt: number;
  endedAt: number;
  /** Fastest single leg, km/h. Null when there is only one fix. */
  topSpeedKmh: number | null;
  /** Distance over time across the whole trip, km/h. */
  averageKmh: number | null;
};

/** Above this, an average leg speed is a vehicle rather than a walk or a bus stop. */
export const HIGH_SPEED_KMH = 60;

/** A gap this long with almost no movement is a stop worth marking. */
export const STOP_MS = 8 * 60 * 1000;

/** Movement under this across a gap counts as not having moved. */
export const STOP_RADIUS_M = 60;

/**
 * Sampling noise floor. A stationary phone still reports fixes that wander by
 * tens of metres, and dividing that wander by a short gap produces impressive
 * nonsense. Legs shorter than this contribute distance but never a speed.
 */
export const MIN_LEG_M = 25;

const R = 6371000;

export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLng = (b.lng - a.lng) * p;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export type RawFix = { lat: number; lng: number; at: string | number };

/**
 * Turn raw fixes into a trip.
 *
 * Pure, so the honesty above is testable rather than asserted. Feed it fixes,
 * check what it refuses to claim.
 */
export function buildTrip(raw: RawFix[]): DriveTrip | null {
  const fixes = raw
    .map((f) => ({
      lat: f.lat,
      lng: f.lng,
      at: typeof f.at === 'number' ? f.at : Date.parse(f.at),
    }))
    .filter((f) => Number.isFinite(f.at) && Number.isFinite(f.lat) && Number.isFinite(f.lng))
    .sort((a, b) => a.at - b.at);

  if (fixes.length < 2) return null;

  const points: DrivePoint[] = [];
  let cumulative = 0;

  for (let i = 0; i < fixes.length; i++) {
    const f = fixes[i];
    let speedKmh: number | null = null;

    if (i > 0) {
      const prev = fixes[i - 1];
      const legM = haversineM(prev, f);
      const legMs = f.at - prev.at;
      cumulative += legM;
      // Both guards matter. A zero gap divides by nothing; a short leg is
      // GPS wander and would report a stationary phone doing 40 km/h.
      if (legMs > 0 && legM >= MIN_LEG_M) {
        speedKmh = (legM / 1000) / (legMs / 3_600_000);
      }
    }

    points.push({ lat: f.lat, lng: f.lng, at: f.at, speedKmh, distanceM: cumulative });
  }

  const durationMs = points[points.length - 1].at - points[0].at;
  const speeds = points.map((p) => p.speedKmh).filter((v): v is number => v !== null);

  return {
    points,
    events: deriveEvents(points),
    distanceM: cumulative,
    durationMs,
    startedAt: points[0].at,
    endedAt: points[points.length - 1].at,
    topSpeedKmh: speeds.length ? Math.max(...speeds) : null,
    averageKmh: durationMs > 0 ? (cumulative / 1000) / (durationMs / 3_600_000) : null,
  };
}

/**
 * Only the two kinds the sampling rate can actually support.
 *
 * Consecutive high-speed legs collapse into one event. Six separate "high
 * speed" chips for one stretch of highway is noise, not information.
 */
export function deriveEvents(points: DrivePoint[]): DriveEvent[] {
  const out: DriveEvent[] = [];
  let runStart = -1;

  const closeRun = (endIdx: number) => {
    if (runStart < 0) return;
    // Attribute the run to its fastest leg, which is the one worth looking at.
    let peak = runStart;
    for (let k = runStart; k <= endIdx; k++) {
      if ((points[k].speedKmh ?? 0) > (points[peak].speedKmh ?? 0)) peak = k;
    }
    const p = points[peak];
    out.push({
      id: `hs_${p.at}`,
      kind: 'high_speed',
      index: peak,
      at: p.at,
      lat: p.lat,
      lng: p.lng,
      label: 'Fast stretch',
      detail: `About ${Math.round(p.speedKmh ?? 0)} km/h average`,
    });
    runStart = -1;
  };

  for (let i = 1; i < points.length; i++) {
    const s = points[i].speedKmh;
    if (s !== null && s >= HIGH_SPEED_KMH) {
      if (runStart < 0) runStart = i;
    } else {
      closeRun(i - 1);
    }

    // A stop is a long gap the phone spent in one place. This one IS visible at
    // a 60 second sample, which is exactly why it is here and hard braking is
    // not.
    const gap = points[i].at - points[i - 1].at;
    if (gap >= STOP_MS && haversineM(points[i - 1], points[i]) <= STOP_RADIUS_M) {
      const mins = Math.round(gap / 60000);
      out.push({
        id: `stop_${points[i - 1].at}`,
        kind: 'long_stop',
        index: i - 1,
        at: points[i - 1].at,
        lat: points[i - 1].lat,
        lng: points[i - 1].lng,
        label: 'Stopped',
        detail: `${mins} minutes in one place`,
      });
    }
  }
  closeRun(points.length - 1);

  return out.sort((a, b) => a.at - b.at);
}

/** Where the marker sits at a scrubber position, interpolated between fixes. */
export function positionAt(
  trip: DriveTrip,
  t: number,
): { lat: number; lng: number; speedKmh: number | null; index: number } {
  const pts = trip.points;
  if (t <= pts[0].at) {
    return { lat: pts[0].lat, lng: pts[0].lng, speedKmh: null, index: 0 };
  }
  const last = pts[pts.length - 1];
  if (t >= last.at) {
    return { lat: last.lat, lng: last.lng, speedKmh: last.speedKmh, index: pts.length - 1 };
  }

  let i = 1;
  while (i < pts.length && pts[i].at < t) i++;
  const a = pts[i - 1];
  const b = pts[i];
  const span = b.at - a.at;
  const f = span > 0 ? (t - a.at) / span : 0;

  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lng: a.lng + (b.lng - a.lng) * f,
    speedKmh: b.speedKmh,
    index: i - 1,
  };
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m`;
}

/** Fetch one member's trail for the day and build the trip from it. */
export async function loadTrip(userId: string, hours = 24): Promise<DriveTrip | null> {
  const { data, error } = await supabase.rpc('circle_member_trail', {
    p_uid: userId,
    p_hours: hours,
  });
  if (error || !Array.isArray(data)) return null;
  return buildTrip(data as RawFix[]);
}
