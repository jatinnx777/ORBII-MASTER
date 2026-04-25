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

export async function getCurrentLocation(): Promise<GeoPoint> {
  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
}

// Optimised for the SOS critical path: returns the cached fix instantly if
// one is available (every modern Android caches the last GPS read for ~3s),
// then falls back to a Balanced-accuracy live read which is ~3x faster than
// High-accuracy. Use this when latency matters more than the last 5m of
// precision; reverse-geocoding can be done off the critical path.
export async function getFastLocation(): Promise<GeoPoint> {
  try {
    const cached = await Location.getLastKnownPositionAsync({
      maxAge: 30_000,
      requiredAccuracy: 100,
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
  const live = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
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
