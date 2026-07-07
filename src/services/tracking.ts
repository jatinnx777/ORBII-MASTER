import { watchPositionRich, type LocationWatcher, type RichFix } from './location';
import {
  publishLiveLocation,
  subscribeVictimLocation,
  type LiveLocationHandle,
  type Responder,
} from './live-location';
import { fetchRoute } from './osrm';
import { haversineMeters, snapToRoute } from '@/utils/geo';
import type { GeoPoint } from '@/types';

// TrackingService — the single engine behind the responder's live-tracking
// screen. It fuses three streams into one clean snapshot the UI just renders:
//   1. the responder's own fused-provider GPS (published to the victim), with
//      accuracy / heading, and road-snapped onto the active route,
//   2. the victim's live position over realtime (a moving victim is followed),
//   3. an OSRM route + ETA that re-computes as either side moves.
// No paid APIs: OSRM for routing, Supabase realtime for the victim stream,
// nearest-segment projection for map-matching.

export type AccuracyLevel = 'high' | 'medium' | 'approx' | 'unknown';

export type RouteLine = {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};

export type TrackingSnapshot = {
  helper: GeoPoint | null; // road-snapped, for the marker
  victim: GeoPoint;
  headingDeg: number | null;
  accuracyM: number | null;
  accuracy: AccuracyLevel;
  route: RouteLine | null;
  etaSeconds: number | null;
  roadMeters: number | null;
  straightMeters: number | null;
  victimMoving: boolean;
};

export type TrackingHandle = {
  stop: () => void;
  /** Pause/resume sharing the responder's live position back to the victim. */
  setShare: (on: boolean) => void;
  /** Announce arrival to the victim (they then confirm to resolve the SOS). */
  markArrived: () => void;
};

function accuracyLevel(m: number | null): AccuracyLevel {
  if (m == null) return 'unknown';
  if (m <= 15) return 'high';
  if (m <= 40) return 'medium';
  return 'approx';
}

const ROUTE_MIN_INTERVAL_MS = 3000; // don't hammer OSRM
const HELPER_REROUTE_M = 25; // helper moved this far → new route
const VICTIM_REROUTE_M = 20; // victim moved this far → new route
const SNAP_CORRIDOR_M = 28; // only snap when genuinely near the road
const VICTIM_MOVE_M = 8; // victim moved this far recently → "moving"
const VICTIM_MOVE_WINDOW_MS = 7000;

export function startTracking(opts: {
  sosId: string;
  responder: Responder;
  victim: GeoPoint;
  onSnapshot: (s: TrackingSnapshot) => void;
}): TrackingHandle {
  const { sosId, responder, victim: initialVictim, onSnapshot } = opts;

  const state: TrackingSnapshot = {
    helper: null,
    victim: initialVictim,
    headingDeg: null,
    accuracyM: null,
    accuracy: 'unknown',
    route: null,
    etaSeconds: null,
    roadMeters: null,
    straightMeters: null,
    victimMoving: false,
  };

  let lastRouteAt = 0;
  let routeFrom: GeoPoint | null = null;
  let routeTo: GeoPoint | null = null;
  let victimAnchor: { point: GeoPoint; at: number } | null = null;
  let stopped = false;
  let share = true;
  let routeAbort: AbortController | null = null;

  const emit = () => {
    if (!stopped) onSnapshot({ ...state });
  };

  const maybeRoute = (force = false) => {
    if (!state.helper) return;
    const now = Date.now();
    const helperMoved =
      !routeFrom || haversineMeters(routeFrom, state.helper) > HELPER_REROUTE_M;
    const victimMoved =
      !routeTo || haversineMeters(routeTo, state.victim) > VICTIM_REROUTE_M;
    if (!force && !helperMoved && !victimMoved && state.route) return;
    if (now - lastRouteAt < ROUTE_MIN_INTERVAL_MS && !force) return;
    lastRouteAt = now;
    routeFrom = state.helper;
    routeTo = state.victim;
    routeAbort?.abort();
    routeAbort = new AbortController();
    const from = state.helper;
    const to = state.victim;
    fetchRoute(from, to, routeAbort.signal)
      .then((res) => {
        if (stopped || !res) return;
        state.route = { geometry: res.geometry };
        state.etaSeconds = res.durationSeconds;
        state.roadMeters = res.distanceMeters;
        emit();
      })
      .catch(() => undefined);
  };

  // 1 + 2: responder GPS → publish + snap + reroute
  const live: LiveLocationHandle = publishLiveLocation(sosId, responder);
  let watcher: LocationWatcher | null = null;
  watchPositionRich((fix: RichFix) => {
    if (stopped) return;
    if (share) live.publish(fix.point);
    // Road-snap: project the raw fix onto the active route; keep the raw fix
    // when there's no route yet or the snap would yank it too far (genuinely
    // off-road).
    let snapped = fix.point;
    if (state.route) {
      const s = snapToRoute(fix.point, state.route.geometry.coordinates);
      if (s && s.distanceM <= SNAP_CORRIDOR_M) snapped = s.point;
    }
    state.helper = snapped;
    state.accuracyM = fix.accuracyM;
    state.accuracy = accuracyLevel(fix.accuracyM);
    // Prefer the fused heading; fall back to bearing of travel is handled in UI.
    if (fix.headingDeg != null) state.headingDeg = fix.headingDeg;
    state.straightMeters = haversineMeters(snapped, state.victim);
    maybeRoute();
    emit();
  }).then((w) => {
    watcher = w;
    if (stopped) w.remove();
  });

  // 2: victim live position (a moving victim is followed)
  const victimSub = subscribeVictimLocation(sosId, ({ point, at }) => {
    if (stopped) return;
    // movement detection over a short window
    if (
      victimAnchor &&
      at - victimAnchor.at <= VICTIM_MOVE_WINDOW_MS &&
      haversineMeters(victimAnchor.point, point) >= VICTIM_MOVE_M
    ) {
      state.victimMoving = true;
    } else if (!victimAnchor || at - victimAnchor.at > VICTIM_MOVE_WINDOW_MS) {
      state.victimMoving =
        victimAnchor != null &&
        haversineMeters(victimAnchor.point, point) >= VICTIM_MOVE_M;
      victimAnchor = { point, at };
    }
    state.victim = point;
    if (state.helper) state.straightMeters = haversineMeters(state.helper, point);
    maybeRoute();
    emit();
  });

  return {
    stop: () => {
      stopped = true;
      routeAbort?.abort();
      watcher?.remove();
      live.unsubscribe();
      victimSub.unsubscribe();
    },
    setShare: (on: boolean) => {
      share = on;
    },
    markArrived: () => {
      if (state.helper) live.announceArrived(state.helper);
    },
  };
}
