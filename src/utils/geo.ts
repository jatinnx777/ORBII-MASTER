import type { GeoPoint } from '@/types';

const EARTH_RADIUS_M = 6_371_000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolate(a: GeoPoint, b: GeoPoint, t: number): GeoPoint {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * clamped,
    longitude: a.longitude + (b.longitude - a.longitude) * clamped,
  };
}

export function offsetPoint(
  base: GeoPoint,
  distanceMeters: number,
  bearingRad: number,
): GeoPoint {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const lat1 = toRad(base.latitude);
  const lon1 = toRad(base.longitude);
  const sinLat2 =
    Math.sin(lat1) * Math.cos(angular) +
    Math.cos(lat1) * Math.sin(angular) * Math.cos(bearingRad);
  const lat2 = Math.asin(sinLat2);
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * sinLat2,
    );
  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
}

// Compass bearing a→b in degrees (0 = North, clockwise). Drives the heading
// arrow on the live marker.
export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

// Map-matching without a paid API: project a raw GPS point onto the nearest
// segment of the current route polyline. If the fix is within a sane corridor
// the marker rides the road instead of drifting into buildings/fields. Uses a
// local equirectangular projection (accurate over the few-metre scale of GPS
// drift). `coords` is the route geometry as [lng, lat] pairs.
export function snapToRoute(
  point: GeoPoint,
  coords: [number, number][],
): { point: GeoPoint; distanceM: number } | null {
  if (!coords || coords.length < 2) return null;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(toRad(point.latitude));
  const px = point.longitude * mPerDegLng;
  const py = point.latitude * mPerDegLat;
  let best: GeoPoint | null = null;
  let bestD2 = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = coords[i][0] * mPerDegLng;
    const ay = coords[i][1] * mPerDegLat;
    const bx = coords[i + 1][0] * mPerDegLng;
    const by = coords[i + 1][1] * mPerDegLat;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { longitude: cx / mPerDegLng, latitude: cy / mPerDegLat };
    }
  }
  if (!best) return null;
  return { point: best, distanceM: Math.sqrt(bestD2) };
}

export function etaSeconds(distanceMeters: number, avgSpeedKmh = 20): number {
  if (distanceMeters <= 0) return 0;
  const metersPerSecond = (avgSpeedKmh * 1000) / 3600;
  return Math.round(distanceMeters / metersPerSecond);
}

export function formatDistance(meters: number): string {
  if (meters < 0) return '0m';
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

export function formatEta(seconds: number): string {
  if (seconds <= 30) return 'Arriving';
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} min`;
}

export function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}
