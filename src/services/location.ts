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
