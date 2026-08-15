import { supabase } from './supabase';
import type { GeoPoint } from '@/types';

// Helpers System, backed by sql/12_helpers.sql (PostGIS).
//
//   • `setHelperLocation` upserts the caller's live position + online flag
//     via the `set_helper_location` RPC (owner-only row, RLS enforced).
//   • `findNearestHelpers` calls the `nearest_helpers` SECURITY DEFINER RPC,
//     which does an indexed radius search on the DB and returns only online,
//     fresh helpers within range, nearest first. Scales to 100k+ rows.
//
// No paid geo APIs: distance + radius are computed in PostGIS on Supabase.

export type NearestHelper = {
  userId: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  distanceMeters: number;
  location: GeoPoint;
};

type NearestHelperRow = {
  user_id: string;
  name: string | null;
  photo_url: string | null;
  rating: number | string | null;
  distance_m: number | string | null;
  lat_h: number;
  lng_h: number;
};

/** Upsert the current user's helper location + online state. */
export async function setHelperLocation(
  point: GeoPoint,
  online: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_helper_location', {
    p_lat: point.latitude,
    p_lng: point.longitude,
    p_online: online,
  });
  if (error) throw error;
}

/** Mark the current user offline as a helper (best-effort). */
export async function goOffline(point: GeoPoint | null): Promise<void> {
  if (!point) return;
  await setHelperLocation(point, false).catch(() => undefined);
}

/** Online, fresh helpers within `radiusKm`, nearest first. */
export async function findNearestHelpers(
  point: GeoPoint,
  radiusKm = 5,
  limit = 10,
): Promise<NearestHelper[]> {
  const { data, error } = await supabase.rpc('nearest_helpers', {
    lat: point.latitude,
    lng: point.longitude,
    radius_km: radiusKm,
    limit_count: limit,
  });
  if (error || !data) {
    if (error) console.warn('[helpers] nearest_helpers failed', error.message);
    return [];
  }
  return (data as NearestHelperRow[]).map((row) => ({
    userId: row.user_id,
    name: row.name ?? 'Helper',
    photoUrl: row.photo_url,
    rating: Number(row.rating ?? 5),
    distanceMeters: Number(row.distance_m ?? 0),
    location: { latitude: row.lat_h, longitude: row.lng_h },
  }));
}

/** Count online helpers within `radiusKm` of the point. */
export async function countHelpersNearby(
  point: GeoPoint,
  radiusKm = 5,
): Promise<number> {
  const helpers = await findNearestHelpers(point, radiusKm, 50);
  return helpers.length;
}
