import { haversineMeters, snapToRoute } from '@/utils/geo';
import { MOVEMENT } from './config';
import type { GeoPoint } from '@/types';

// RouteVerificationService, proves the helper actually travelled. Each fix is
// snapped to the live route (map-matching) and the road distance is accumulated
// from the snapped track, so drift and fake GPS jumps don't inflate the number.
// Impossible speeds and teleports are flagged as fraud signals rather than
// counted as distance.

export type RouteVerifier = {
  add: (point: GeoPoint, atMs: number, routeCoords?: [number, number][]) => void;
  roadMeters: () => number;
  flags: () => string[];
};

export function createRouteVerifier(): RouteVerifier {
  let last: { point: GeoPoint; at: number } | null = null;
  let meters = 0;
  const flags = new Set<string>();

  return {
    add(point, atMs, routeCoords) {
      const snapped =
        routeCoords && routeCoords.length > 1
          ? snapToRoute(point, routeCoords)?.point ?? point
          : point;

      if (last) {
        const d = haversineMeters(last.point, snapped);
        const dt = (atMs - last.at) / 1000;
        const speed = dt > 0 ? d / dt : 0;

        if (speed > MOVEMENT.maxSpeedMps) flags.add('impossible_speed');
        if (d > MOVEMENT.teleportM && dt < 3) flags.add('teleport');

        // Only accumulate physically-plausible movement.
        if (speed <= MOVEMENT.maxSpeedMps && d < MOVEMENT.teleportM) meters += d;
      }
      last = { point: snapped, at: atMs };
    },
    roadMeters: () => Math.round(meters),
    flags: () => Array.from(flags),
  };
}
