/**
 * Offline place resolution.
 *
 * Turns a raw fix into a name a frightened person can say out loud, with no
 * network, no Google Maps, and no API key. "Hostel 3, Block A" is something a
 * helper can run to. "28.99312, 77.01507" is not.
 *
 * THE RULE THIS FILE IS BUILT AROUND: a wrong name is worse than no name.
 *
 * If we tell her circle she is at the Central Library and she is actually behind
 * the sports complex, people search the wrong building while she waits. Raw
 * coordinates are always correct and always useful, a wrong landmark is
 * confidently useless, so this resolver returns a landmark ONLY when the data
 * behind it was physically surveyed and the fix is genuinely inside it.
 *
 * That is why ZoneDefinition carries `surveyed`. Polygons drawn by eye off a
 * satellite image are fine for "is she on campus", and are never allowed to
 * produce a confident building name. The type makes you say which kind you have.
 */

import { haversineMeters } from '@/utils/geo';

export type ZoneType =
  | 'hostel'
  | 'academic'
  | 'library'
  | 'canteen'
  | 'sports'
  | 'gate'
  | 'medical'
  | 'parking'
  | 'campus_boundary';

export type LatLng = { lat: number; lng: number };

export type ZoneDefinition = {
  id: string;
  /** Said out loud in an emergency. "Hostel 3, Block A", not "H3-BA". */
  name: string;
  zoneType: ZoneType;
  /**
   * Ring of vertices. Open or closed both work; the solver closes it.
   * Minimum 3 points, anything less is rejected at registration.
   */
  polygonCoordinates: LatLng[];
  /**
   * TRUE only if somebody walked the perimeter with a phone and recorded these
   * points. Traced off a satellite image is FALSE.
   *
   * An unsurveyed zone can still say "on campus". It can never be reported as a
   * confident location, because an eyeballed polygon is routinely 20 to 50 m
   * out, which on a dense campus is the wrong building.
   */
  surveyed: boolean;
  /** Optional sub-location once inside, e.g. floor labels. Free text. */
  detail?: string;
};

export type OfflineLocation = {
  /** Always safe to show a human. Never a guess dressed as a fact. */
  locationName: string;
  isWithinCampus: boolean;
  /**
   * 0 to 1.
   *   1.00  inside a surveyed polygon
   *   0.55  inside an unsurveyed polygon (right area, do not trust the name)
   *   0.10 to 0.50  near a surveyed landmark, scaled by distance
   *   0.00  no campus data, or too far from anything
   *
   * Anything below CONFIDENT_THRESHOLD must be shown with its hedge intact.
   */
  confidence: number;
  /** Which zone answered, if any. Null when we fell back to coordinates. */
  zoneId: string | null;
  /** Metres to the nearest known landmark, when the fix was outside every zone. */
  nearestDistanceM: number | null;
  /** Machine-readable reason, so a caller can branch without parsing prose. */
  basis: 'inside_surveyed' | 'inside_unsurveyed' | 'near_landmark' | 'coordinates_only';
};

/** Below this, the name is a hint and the UI must keep the hedge wording. */
export const CONFIDENT_THRESHOLD = 0.75;

/**
 * How far outside a polygon we will still name the nearest landmark.
 *
 * 150 m is about one building away on a campus. Past that, "near the library"
 * stops being a direction and starts being noise, and coordinates are better.
 */
export const NEAR_LANDMARK_MAX_M = 150;

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Ray casting, counting crossings of a horizontal ray heading east.
 *
 * Treated as planar. Over a campus (under 2 km) the error from ignoring the
 * curve of the earth is far below GPS noise, so the extra maths would buy
 * nothing. This is NOT safe for continent-scale polygons.
 *
 * The `(yi > y) !== (yj > y)` test is deliberately asymmetric: it counts a
 * vertex as belonging to the edge above it, which is what stops a ray passing
 * exactly through a vertex from being counted twice and flipping the answer.
 */
export function isPointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;

  const x = point.lng;
  const y = point.lat;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lng;
    const yi = polygon[i].lat;
    const xj = polygon[j].lng;
    const yj = polygon[j].lat;

    if (yi > y !== yj > y) {
      // x of the edge at this latitude. yj - yi cannot be 0 here: the test
      // above already proved the two vertices sit on opposite sides of y.
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xCross) inside = !inside;
    }
  }
  return inside;
}

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

function boundsOf(polygon: LatLng[]): Bounds {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of polygon) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

function inBounds(p: LatLng, b: Bounds): boolean {
  return p.lat >= b.minLat && p.lat <= b.maxLat && p.lng >= b.minLng && p.lng <= b.maxLng;
}

function centroidOf(polygon: LatLng[]): LatLng {
  let lat = 0;
  let lng = 0;
  for (const p of polygon) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / polygon.length, lng: lng / polygon.length };
}

/** Shortest distance from a point to a polygon's perimeter, in metres. */
function distanceToPerimeterM(point: LatLng, polygon: LatLng[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const d = distanceToSegmentM(point, polygon[j], polygon[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * Point-to-segment distance.
 *
 * Projects onto a local metres-per-degree plane first. Longitude degrees shrink
 * with latitude, so treating raw degrees as square would stretch east-west
 * distance by about 14 percent at Sonipat's latitude and quietly pick the wrong
 * nearest building.
 */
function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const latRad = (p.lat * Math.PI) / 180;
  const mPerDegLat = 111_132;
  const mPerDegLng = 111_320 * Math.cos(latRad);

  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;

  const lenSq = bx * bx + by * by;
  if (lenSq === 0) return Math.hypot(px, py); // a and b are the same point

  let t = (px * bx + py * by) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - t * bx, py - t * by);
}

// ---------------------------------------------------------------------------
// The zone registry
// ---------------------------------------------------------------------------

type CompiledZone = ZoneDefinition & { bounds: Bounds; centroid: LatLng };

const zones: CompiledZone[] = [];

/** Thrown only at registration, never during a lookup. */
export class InvalidZoneError extends Error {}

function compile(zone: ZoneDefinition): CompiledZone {
  if (!zone.id || !zone.name) {
    throw new InvalidZoneError('a zone needs an id and a human-readable name');
  }
  if (zone.polygonCoordinates.length < 3) {
    throw new InvalidZoneError(`zone ${zone.id} has fewer than 3 vertices`);
  }
  for (const p of zone.polygonCoordinates) {
    if (
      !Number.isFinite(p.lat) ||
      !Number.isFinite(p.lng) ||
      p.lat < -90 ||
      p.lat > 90 ||
      p.lng < -180 ||
      p.lng > 180
    ) {
      throw new InvalidZoneError(`zone ${zone.id} has an out-of-range vertex`);
    }
  }
  return {
    ...zone,
    bounds: boundsOf(zone.polygonCoordinates),
    centroid: centroidOf(zone.polygonCoordinates),
  };
}

/**
 * Load campus zones. Replaces whatever was loaded before.
 *
 * Kept as a function rather than a hardcoded constant because campus geometry is
 * survey data, not source code: it differs per campus, it gets corrected, and it
 * should be replaceable without shipping a build. Feed it from bundled JSON, or
 * from a table synced while online and cached for use offline.
 *
 * Invalid zones are skipped and reported. One bad polygon in a file must not
 * take the whole resolver down during an emergency.
 */
export function loadCampusZones(input: ZoneDefinition[]): {
  loaded: number;
  rejected: { id: string; reason: string }[];
} {
  const rejected: { id: string; reason: string }[] = [];
  const next: CompiledZone[] = [];

  for (const z of input) {
    try {
      next.push(compile(z));
    } catch (err) {
      rejected.push({
        id: z?.id ?? '(no id)',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  zones.length = 0;
  zones.push(...next);
  return { loaded: next.length, rejected };
}

export function loadedZoneCount(): number {
  return zones.length;
}

export function clearCampusZones(): void {
  zones.length = 0;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function coordinateName(lat: number, lng: number): string {
  // Five decimals is about 1 m. More digits read as false precision and are
  // harder to repeat over a phone call, which is what these get used for.
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function isPlausible(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // Null Island: what an uninitialised struct or a failed fix looks like.
    !(lat === 0 && lng === 0)
  );
}

/**
 * Resolve a fix to a place. Synchronous, allocation-light, never throws.
 *
 * Never throwing is deliberate. This runs on the SOS path, and an exception here
 * would take down the dispatch that was about to carry her coordinates. Any
 * failure degrades to the coordinates, which are always true.
 */
export function resolveOfflineLocation(lat: number, lng: number): OfflineLocation {
  if (!isPlausible(lat, lng)) {
    return {
      locationName: 'Location unavailable',
      isWithinCampus: false,
      confidence: 0,
      zoneId: null,
      nearestDistanceM: null,
      basis: 'coordinates_only',
    };
  }

  const point: LatLng = { lat, lng };
  const fallback: OfflineLocation = {
    locationName: coordinateName(lat, lng),
    isWithinCampus: false,
    confidence: 0,
    zoneId: null,
    nearestDistanceM: null,
    basis: 'coordinates_only',
  };

  if (zones.length === 0) return fallback;

  try {
    // Pass 1: containment. Smallest matching zone wins, so a building inside a
    // campus boundary beats the boundary itself. "Hostel 3" is an answer,
    // "SRM Sonipat campus" is a category.
    let best: CompiledZone | null = null;
    let bestArea = Infinity;
    let insideCampus = false;

    for (const z of zones) {
      if (!inBounds(point, z.bounds)) continue;
      if (!isPointInPolygon(point, z.polygonCoordinates)) continue;

      if (z.zoneType === 'campus_boundary') {
        insideCampus = true;
        continue;
      }
      insideCampus = true;

      const area =
        (z.bounds.maxLat - z.bounds.minLat) * (z.bounds.maxLng - z.bounds.minLng);
      if (area < bestArea) {
        bestArea = area;
        best = z;
      }
    }

    if (best) {
      const name = best.detail ? `${best.name}, ${best.detail}` : best.name;
      return best.surveyed
        ? {
            locationName: name,
            isWithinCampus: true,
            confidence: 1,
            zoneId: best.id,
            nearestDistanceM: 0,
            basis: 'inside_surveyed',
          }
        : {
            // Unsurveyed polygon. The area is right, the name might not be, and
            // the wording says so rather than leaving the caller to remember.
            locationName: `Near ${name}`,
            isWithinCampus: true,
            confidence: 0.55,
            zoneId: best.id,
            nearestDistanceM: 0,
            basis: 'inside_unsurveyed',
          };
    }

    // Pass 2: outside every polygon. Name the nearest SURVEYED landmark if it is
    // close enough to be a direction. Unsurveyed polygons are excluded here:
    // their own edges are already uncertain, so a distance measured from one is
    // uncertainty on top of uncertainty.
    let nearest: CompiledZone | null = null;
    let nearestM = Infinity;

    for (const z of zones) {
      if (!z.surveyed || z.zoneType === 'campus_boundary') continue;
      // Cheap centroid reject before the per-edge walk.
      const rough = haversineMeters(
        { latitude: lat, longitude: lng },
        { latitude: z.centroid.lat, longitude: z.centroid.lng },
      );
      if (rough - NEAR_LANDMARK_MAX_M > nearestM) continue;

      const d = distanceToPerimeterM(point, z.polygonCoordinates);
      if (d < nearestM) {
        nearestM = d;
        nearest = z;
      }
    }

    if (nearest && nearestM <= NEAR_LANDMARK_MAX_M) {
      // Linear decay: touching the wall is 0.50, the far edge of usefulness is
      // 0.10. Never reaches CONFIDENT_THRESHOLD, because being outside a
      // building is not knowing which building you are in.
      const t = 1 - nearestM / NEAR_LANDMARK_MAX_M;
      return {
        locationName: `About ${Math.round(nearestM)} m from ${nearest.name}`,
        isWithinCampus: insideCampus,
        confidence: 0.1 + 0.4 * t,
        zoneId: nearest.id,
        nearestDistanceM: Math.round(nearestM),
        basis: 'near_landmark',
      };
    }

    return {
      ...fallback,
      isWithinCampus: insideCampus,
      nearestDistanceM: Number.isFinite(nearestM) ? Math.round(nearestM) : null,
    };
  } catch (err) {
    // Should be unreachable; kept because this is the SOS path and a geometry
    // bug must degrade to coordinates rather than stop an alarm.
    console.warn('[offlineGeo] resolve failed, falling back to coordinates', err);
    return fallback;
  }
}

/**
 * One line for a human, coordinates always included.
 *
 * The coordinates stay in even when we are certain of the name, because a name
 * is for a person who knows the campus and coordinates are for everyone else,
 * including the police.
 */
export function describeOfflineLocation(loc: OfflineLocation, lat: number, lng: number): string {
  if (loc.basis === 'coordinates_only') return coordinateName(lat, lng);
  return `${loc.locationName} (${coordinateName(lat, lng)})`;
}
