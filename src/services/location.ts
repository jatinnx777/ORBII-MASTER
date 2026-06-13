import * as Location from 'expo-location';
import type {
  GeoPoint,
  LocationPermissionStatus,
  SOSLocation,
} from '@/types';

function mapPermission(
  status: Location.PermissionStatus,
): LocationPermissionStatus {
  switch (status) {
    case Location.PermissionStatus.GRANTED:
      return 'granted';
    case Location.PermissionStatus.DENIED:
      return 'denied';
    default:
      return 'unknown';
  }
}

export async function getCurrentPermission(): Promise<LocationPermissionStatus> {
  const current = await Location.getForegroundPermissionsAsync();
  return mapPermission(current.status);
}

export async function requestPermission(): Promise<LocationPermissionStatus> {
  const result = await Location.requestForegroundPermissionsAsync();
  return mapPermission(result.status);
}

function toPoint(p: Location.LocationObject): GeoPoint {
  return { latitude: p.coords.latitude, longitude: p.coords.longitude };
}

// Accurate location read. A single getCurrentPositionAsync often returns an
// early NETWORK/wifi fix that can be kilometres off indoors — which made two
// phones 5 m apart look "hours away". We force GPS (BestForNavigation) and
// CONVERGE: keep the best (lowest accuracy-radius) reading until it's within
// `targetAccuracyM`, or `timeoutMs` elapses. Never returns 0,0.
async function getAccurateFix(
  timeoutMs = 6000,
  targetAccuracyM = 35,
): Promise<GeoPoint> {
  let best: Location.LocationObject | null = null;

  try {
    best = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.BestForNavigation,
    });
    if ((best.coords.accuracy ?? 9999) <= targetAccuracyM) return toPoint(best);
  } catch {
    // fall through to the watch loop
  }

  const converged = await new Promise<GeoPoint | null>((resolve) => {
    let settled = false;
    let sub: Location.LocationSubscription | null = null;
    const finish = (point: GeoPoint | null) => {
      if (settled) return;
      settled = true;
      sub?.remove();
      resolve(point);
    };
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      (pos) => {
        if (!best || (pos.coords.accuracy ?? 9999) < (best.coords.accuracy ?? 9999)) {
          best = pos;
        }
        if ((pos.coords.accuracy ?? 9999) <= targetAccuracyM) finish(toPoint(pos));
      },
    )
      .then((s) => {
        sub = s;
      })
      .catch(() => finish(null));
    setTimeout(() => finish(best ? toPoint(best) : null), timeoutMs);
  });

  if (converged) return converged;
  if (best) return toPoint(best);

  // Last resort: a cached fix, only if it's reasonably recent + accurate.
  const cached = await Location.getLastKnownPositionAsync({
    maxAge: 60_000,
    requiredAccuracy: 100,
  });
  if (cached) return toPoint(cached);

  // Nothing usable — surface an error rather than returning 0,0 (which would
  // make distance maths nonsensical).
  throw new Error('Could not get an accurate GPS fix. Make sure location is on.');
}

export async function getCurrentLocation(): Promise<GeoPoint> {
  return getAccurateFix();
}

// Optimised for the SOS critical path: returns the cached fix instantly if
// one is available (every modern Android caches the last GPS read for ~3s),
// then falls back to a Balanced-accuracy live read which is ~3x faster than
// High-accuracy. Use this when latency matters more than the last 5m of
// precision; reverse-geocoding can be done off the critical path.
export async function getFastLocation(): Promise<GeoPoint> {
  try {
    // Only trust a recent + reasonably precise cached fix (≤50 m, ≤15 s old).
    // A looser cache is what made SOS broadcasts land far from the user.
    const cached = await Location.getLastKnownPositionAsync({
      maxAge: 15_000,
      requiredAccuracy: 50,
    });
    if (cached) {
      return {
        latitude: cached.coords.latitude,
        longitude: cached.coords.longitude,
      };
    }
  } catch {
    // ignore, fall through to live read
  }
  // High (GPS) rather than Balanced (often network) so the fix is real.
  const live = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    latitude: live.coords.latitude,
    longitude: live.coords.longitude,
  };
}

export async function reverseGeocode(point: GeoPoint): Promise<string | null> {
  try {
    const results = await Location.reverseGeocodeAsync(point);
    const place = results[0];
    if (!place) return null;
    const parts = [
      place.name,
      place.street,
      place.city ?? place.subregion,
      place.region,
      place.postalCode,
    ].filter(Boolean);
    return parts.join(', ') || null;
  } catch {
    return null;
  }
}

export async function getSOSLocation(point: GeoPoint): Promise<SOSLocation> {
  const address = await reverseGeocode(point);
  return { ...point, address };
}

export type LocationWatcher = { remove: () => void };

// Continuous GPS stream. Emits a new point whenever the device moves more
// than `distanceIntervalMeters` or `timeIntervalMs` elapses — whichever
// comes first. Used for Swiggy-style live tracking of a responder.
export async function watchLocation(
  onUpdate: (point: GeoPoint) => void,
  opts: { distanceIntervalMeters?: number; timeIntervalMs?: number } = {},
): Promise<LocationWatcher> {
  const sub = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      distanceInterval: opts.distanceIntervalMeters ?? 8,
      timeInterval: opts.timeIntervalMs ?? 4000,
    },
    (position) => {
      onUpdate({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    },
  );
  return { remove: () => sub.remove() };
}
