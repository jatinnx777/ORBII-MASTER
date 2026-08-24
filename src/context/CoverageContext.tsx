import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import {
  checkCoverage,
  INITIAL_COVERAGE,
  metresBetween,
  type Coverage,
} from '@/services/coverage';

/**
 * Helper Network coverage, app-wide.
 *
 * THE ONE RULE THIS FILE EXISTS TO ENFORCE: nothing here can switch off the
 * Personal Shield. Voice SOS, the SMS relay, circle alerts, evidence recording
 * and 112 are unconditional, everywhere on earth. This context describes
 * whether the *community helper network* can dispatch, which is a different and
 * much smaller question.
 *
 * That is why the context exposes no `canFireSOS`, no `isEnabled`, no boolean
 * that an SOS path could accidentally consult. The dangerous call is not
 * discouraged, it is absent: if somebody later wants to gate a trigger on
 * coverage, they have to add the field themselves and will hopefully read this
 * on the way past.
 *
 * FAILURE DIRECTION. Every error path lands on OFFLINE_PERSONAL_SHIELD, whose
 * copy says the core protections are ready and does NOT claim there are no
 * helpers nearby. A timeout is ignorance, not absence, and on a safety product
 * those must read differently.
 */

type CoverageState = Coverage & {
  isChecking: boolean;
  /**
   * Human-readable place, e.g. "Rai, Sonipat". Null until resolved.
   *
   * Reverse geocoding runs through the OS, not a paid API, so it costs nothing
   * and works without our servers. It also fails silently and often, which is
   * why every consumer must handle null rather than assuming an address.
   */
  placeLabel: string | null;
  /** Raw coordinates, for the "not in your area" state to show precisely. */
  point: { lat: number; lng: number } | null;
  /** Force a re-check. Pull-to-refresh, or after granting location. */
  refresh: () => void;
};

const Ctx = createContext<CoverageState | null>(null);

/**
 * How far the user must move before we ask again.
 *
 * 2 km, per the coverage model. Small enough that crossing out of NCR is caught
 * well before it matters, large enough that a normal day inside a city triggers
 * essentially no extra calls. The watcher below uses this as the OS-level
 * distanceInterval too, so the device wakes us rather than us polling it, which
 * is the difference between a background task and a battery complaint.
 */
const RECHECK_METRES = 2000;

/**
 * Minimum gap between checks regardless of movement.
 *
 * Guards the case the distance filter cannot: standing still while the app is
 * foregrounded and backgrounded repeatedly, which on some launchers happens
 * several times a minute.
 */
const MIN_INTERVAL_MS = 60_000;

export function CoverageProvider({ children }: { children: React.ReactNode }) {
  const [coverage, setCoverage] = useState<Coverage>(INITIAL_COVERAGE);
  const [isChecking, setIsChecking] = useState(false);
  const [placeLabel, setPlaceLabel] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);

  const lastPoint = useRef<{ lat: number; lng: number } | null>(null);
  const lastCheckAt = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const run = useCallback(async (force = false) => {
    // One at a time. Without this, a resume plus a position update in the same
    // second fires two identical RPCs and the later reply wins arbitrarily.
    if (inFlight.current) return;

    const now = Date.now();
    if (!force && now - lastCheckAt.current < MIN_INTERVAL_MS) return;

    inFlight.current = true;
    if (mounted.current) setIsChecking(true);

    try {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted) {
        // No permission is not an error state worth shouting about. The core
        // protections do not need location to fire; only the coverage card does.
        if (mounted.current) setCoverage(INITIAL_COVERAGE);
        return;
      }

      // Cached fix first: it is free and instant. Only pay for a live fix when
      // there is nothing recent, because a GPS acquisition on a cold start can
      // take fifteen seconds and burn real battery.
      let pos = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60_000 }).catch(
        () => null,
      );
      if (!pos) {
        pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }).catch(() => null);
      }
      if (!pos) return;

      const point = { lat: pos.coords.latitude, lng: pos.coords.longitude };

      // Skip if we have not meaningfully moved since the last answer.
      if (
        !force &&
        lastPoint.current &&
        metresBetween(lastPoint.current, point) < RECHECK_METRES
      ) {
        return;
      }

      const result = await checkCoverage(point.lat, point.lng);
      lastPoint.current = point;
      lastCheckAt.current = Date.now();
      if (mounted.current) {
        setCoverage(result);
        setPoint(point);
        // CLEAR THE OLD ADDRESS THE MOMENT THE POINT MOVES.
        //
        // Found by moving the emulator from Sonipat to Mumbai: coverage
        // correctly flipped to "not in your area yet" while the line beneath it
        // still read "Rohtak Division, Patla", because the geocode below only
        // ever WROTE on success. A stale place under a coverage verdict is the
        // worst of both worlds: it looks authoritative and it is wrong, and
        // somebody checking why they are unserviceable would be reading another
        // city's name. Falling back to raw coordinates is uglier and honest.
        setPlaceLabel(null);
      }

      // Address is cosmetic and must never delay or block the coverage answer,
      // so it is resolved after and failure is swallowed. On many devices the
      // OS geocoder is simply absent and returns nothing at all.
      void Location.reverseGeocodeAsync({
        latitude: point.lat,
        longitude: point.lng,
      })
        .then((places) => {
          const p = places?.[0];
          if (!p || !mounted.current) return;
          // Neighbourhood then city is what people recognise. Street numbers
          // are noise here and, on a shared screen, needlessly precise.
          const parts = [
            p.district || p.subregion || p.name,
            p.city || p.region,
          ].filter(Boolean) as string[];
          const seen = new Set<string>();
          const label = parts.filter((x) => !seen.has(x) && seen.add(x)).join(', ');
          setPlaceLabel(label || null);
        })
        .catch(() => undefined);
    } catch {
      // Never let a coverage check surface as an error to the user. The whole
      // point is that it degrades to "Personal Shield active" silently.
      if (mounted.current) setCoverage(INITIAL_COVERAGE);
    } finally {
      inFlight.current = false;
      if (mounted.current) setIsChecking(false);
    }
  }, []);

  // First check on mount.
  useEffect(() => {
    mounted.current = true;
    void run(true);
    return () => {
      mounted.current = false;
    };
  }, [run]);

  // Re-check when the app comes back to the foreground. Someone who put the
  // phone away in Delhi and took it out in Jaipur should not see a stale pill.
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'active') void run(false);
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [run]);

  // Movement watcher.
  //
  // distanceInterval pushes the filtering down to the OS, so the device decides
  // when we are woken instead of us waking up to ask. timeInterval is a floor,
  // not a schedule: it caps how often the OS may deliver, it does not request
  // an update every five minutes.
  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;

    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (!perm?.granted || cancelled) return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: RECHECK_METRES,
          timeInterval: 5 * 60_000,
        },
        () => {
          // The handler deliberately ignores the position it is handed and lets
          // run() re-read it. One code path fetches location, so the cached-fix
          // and distance-threshold logic cannot drift between two callers.
          void run(false);
        },
      ).catch(() => null);
    })();

    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [run]);

  const value = useMemo<CoverageState>(
    () => ({ ...coverage, isChecking, placeLabel, point, refresh: () => void run(true) }),
    [coverage, isChecking, placeLabel, point, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read coverage.
 *
 * Returns the offline default rather than throwing when used outside the
 * provider. A missing provider must never be able to break a screen on a safety
 * app, and the default is the safe direction: core protections on, helper
 * network not claimed.
 */
export function useCoverage(): CoverageState {
  const ctx = useContext(Ctx);
  if (ctx) return ctx;
  return {
    ...INITIAL_COVERAGE,
    isChecking: false,
    placeLabel: null,
    point: null,
    refresh: () => {},
  };
}

/** Convenience aliases matching the field names used in the product spec. */
export function useCoverageFlags() {
  const c = useCoverage();
  return {
    isInDelhiNCR: c.isInServiceArea,
    helperNetworkAvailable: c.helperNetworkAvailable,
    nearbyHelpersCount: c.nearbyHelpersCount,
    statusMessage: c.message,
    isChecking: c.isChecking,
  };
}
