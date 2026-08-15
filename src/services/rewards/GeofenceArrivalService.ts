import { haversineMeters } from '@/utils/geo';
import { GEOFENCE } from './config';
import type { GeoPoint } from '@/types';

// GeofenceArrivalService, arrival is DETECTED, never tapped. A helper only
// counts as "arrived" after dwelling inside the arrival radius for the dwell
// time; departure uses a wider radius (hysteresis) so GPS wobble near the edge
// doesn't bounce the state. This is what the reward engine trusts for arrival , 
// there is deliberately no manual confirmation path into the reward.

export type Geofence = {
  /** Feed each helper fix; returns the current state after the update. */
  update: (helper: GeoPoint, atMs?: number) => 'outside' | 'dwelling' | 'arrived' | 'departed';
  hasArrived: () => boolean;
};

export function createGeofence(
  center: GeoPoint,
  handlers: { onArrived?: () => void; onDepart?: () => void } = {},
): Geofence {
  let insideSince: number | null = null;
  let arrived = false;
  let departed = false;

  return {
    update(helper, atMs = Date.now()) {
      if (departed) return 'departed';
      const d = haversineMeters(helper, center);

      if (!arrived) {
        if (d <= GEOFENCE.arriveRadiusM) {
          if (insideSince == null) insideSince = atMs;
          if (atMs - insideSince >= GEOFENCE.dwellMs) {
            arrived = true;
            handlers.onArrived?.();
            return 'arrived';
          }
          return 'dwelling';
        }
        insideSince = null;
        return 'outside';
      }

      // already arrived → watch for a genuine departure
      if (d > GEOFENCE.departRadiusM) {
        departed = true;
        handlers.onDepart?.();
        return 'departed';
      }
      return 'arrived';
    },
    hasArrived: () => arrived,
  };
}
