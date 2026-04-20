// Road routing via OSRM's public demo server.
// This is the same engine Uber / Zomato-style apps use (OpenStreetMap road
// graph + shortest-path over Dijkstra/Contraction Hierarchies). The public
// demo host is free and unlimited for testing but has no SLA — swap to a
// self-hosted OSRM or a paid Mapbox/Google Directions endpoint before
// production traffic.

import type { GeoPoint } from '@/types';

const OSRM_BASE = 'https://router.project-osrm.org/route/v1';

export type RouteStep = {
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
  maneuver: string;
  location: GeoPoint;
};

export type Route = {
  polyline: GeoPoint[];
  distanceMeters: number;
  durationSeconds: number;
  steps: RouteStep[];
};

type OsrmStep = {
  distance: number;
  duration: number;
  name?: string;
  maneuver: {
    type?: string;
    modifier?: string;
    location: [number, number];
  };
};

type OsrmResponse = {
  code: string;
  routes?: Array<{
    geometry: string;
    distance: number;
    duration: number;
    legs: Array<{ steps: OsrmStep[] }>;
  }>;
};

// Polyline5 decoder — Google's polyline algorithm, which OSRM emits by
// default. Returns GeoPoints in order along the route.
function decodePolyline(str: string): GeoPoint[] {
  const coords: GeoPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < str.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coords.push({ latitude: lat * 1e-5, longitude: lng * 1e-5 });
  }
  return coords;
}

function humanInstruction(step: OsrmStep): string {
  const road = step.name ? ` onto ${step.name}` : '';
  const type = step.maneuver.type ?? 'continue';
  const modifier = step.maneuver.modifier;
  switch (type) {
    case 'depart':
      return `Head out${road}`;
    case 'arrive':
      return 'Arrive at destination';
    case 'turn':
    case 'end of road':
    case 'fork':
    case 'merge':
    case 'ramp':
    case 'on ramp':
    case 'off ramp':
      return modifier ? `Turn ${modifier}${road}` : `Continue${road}`;
    case 'roundabout':
    case 'rotary':
      return `Take the roundabout${road}`;
    case 'continue':
    case 'new name':
      return `Continue${road}`;
    default:
      return modifier ? `${type} ${modifier}${road}` : `${type}${road}`;
  }
}

export async function fetchRoute(
  origin: GeoPoint,
  destination: GeoPoint,
  signal?: AbortSignal,
): Promise<Route> {
  const coords =
    `${origin.longitude},${origin.latitude};` +
    `${destination.longitude},${destination.latitude}`;
  const url =
    `${OSRM_BASE}/driving/${coords}` +
    `?overview=full&geometries=polyline&steps=true&alternatives=false`;

  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`OSRM HTTP ${res.status}`);
  }
  const data = (await res.json()) as OsrmResponse;
  if (data.code !== 'Ok' || !data.routes?.length) {
    throw new Error(`OSRM: ${data.code ?? 'no route'}`);
  }

  const route = data.routes[0];
  const polyline = decodePolyline(route.geometry);
  const steps: RouteStep[] = route.legs
    .flatMap((leg) => leg.steps)
    .map((s) => ({
      distanceMeters: s.distance,
      durationSeconds: s.duration,
      instruction: humanInstruction(s),
      maneuver: s.maneuver.type ?? 'continue',
      location: {
        latitude: s.maneuver.location[1],
        longitude: s.maneuver.location[0],
      },
    }));

  return {
    polyline,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
    steps,
  };
}

// Returns a point that is `t` (0..1) of the way along the polyline by
// cumulative road distance — used to animate the driver pin along the
// real route rather than a straight line.
export function pointAlongRoute(polyline: GeoPoint[], t: number): GeoPoint {
  if (polyline.length === 0) throw new Error('empty polyline');
  if (polyline.length === 1) return polyline[0];
  const clamped = Math.max(0, Math.min(1, t));

  const segLengths: number[] = [];
  let total = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = flatDistance(polyline[i], polyline[i + 1]);
    segLengths.push(d);
    total += d;
  }
  if (total === 0) return polyline[0];

  const target = clamped * total;
  let walked = 0;
  for (let i = 0; i < segLengths.length; i++) {
    if (walked + segLengths[i] >= target) {
      const local = (target - walked) / segLengths[i];
      const a = polyline[i];
      const b = polyline[i + 1];
      return {
        latitude: a.latitude + (b.latitude - a.latitude) * local,
        longitude: a.longitude + (b.longitude - a.longitude) * local,
      };
    }
    walked += segLengths[i];
  }
  return polyline[polyline.length - 1];
}

// Cheap flat-earth distance — accurate enough for interpolation along
// sub-kilometer segments within a single city route.
function flatDistance(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.latitude - a.latitude) * 111_320;
  const midLat = ((a.latitude + b.latitude) / 2) * (Math.PI / 180);
  const dLng = (b.longitude - a.longitude) * 111_320 * Math.cos(midLat);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}
