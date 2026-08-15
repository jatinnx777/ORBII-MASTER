import type { GeoPoint } from '@/types';

// OSRM driving routing, public demo server, free, no API key.
//
//   https://router.project-osrm.org/route/v1/driving/{lon,lat;lon,lat}?overview=full&geometries=geojson
//
// Returns a GeoJSON LineString (drawable as a MapLibre ShapeSource), plus
// duration in seconds and distance in metres. The demo server has rate
// limits and is not guaranteed for production traffic, fine for MVP /
// pilot.

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

export type RouteResult = {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  durationSeconds: number;
  distanceMeters: number;
};

type OSRMResponse = {
  code: string;
  routes?: Array<{
    geometry: { type: 'LineString'; coordinates: [number, number][] };
    duration: number;
    distance: number;
  }>;
};

// Last good route, returned when a fetch fails or aborts. Keeps the UI
// from flickering when OSRM hiccups during live tracking.
const lastByKey = new Map<string, RouteResult>();

function key(from: GeoPoint, to: GeoPoint): string {
  return `${from.latitude.toFixed(4)},${from.longitude.toFixed(4)}>${to.latitude.toFixed(4)},${to.longitude.toFixed(4)}`;
}

export async function fetchRoute(
  from: GeoPoint,
  to: GeoPoint,
  signal?: AbortSignal,
): Promise<RouteResult | null> {
  const url =
    `${OSRM_BASE}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
    `?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return lastByKey.get(key(from, to)) ?? null;
    const json = (await res.json()) as OSRMResponse;
    const route = json.routes?.[0];
    if (!route) return lastByKey.get(key(from, to)) ?? null;
    const result: RouteResult = {
      geometry: route.geometry,
      durationSeconds: route.duration,
      distanceMeters: route.distance,
    };
    lastByKey.set(key(from, to), result);
    return result;
  } catch {
    return lastByKey.get(key(from, to)) ?? null;
  }
}

export function formatEta(durationSeconds: number): string {
  if (durationSeconds < 60) return '<1 min away';
  const minutes = Math.round(durationSeconds / 60);
  return `${minutes} min away`;
}
