import { supabase } from './supabase';
import { haversineMeters } from '@/utils/geo';
import type { GeoPoint } from '@/types';

export type NearestHelper = {
  userId: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  distanceMeters: number;
  location: GeoPoint;
};

// Count verified, online helpers within `radiusKm` of the given point.
// Queries the `helpers_live` table + nearest_helpers RPC on Supabase.
export async function countHelpersNearby(
  point: GeoPoint,
  radiusKm = 2,
): Promise<number> {
  const helpers = await findNearestHelpers(point, radiusKm, 50);
  return helpers.length;
}

// Shortest-path = straight-line nearest-first (great-circle Haversine).
// Real road distance needs Google/Mapbox Directions (paid). For MVP we use
// Haversine which is the tight lower bound and a reasonable proxy for
// dense urban areas. RPC runs on the DB for scale; client fallback runs on
// the (already bounded) result set.
export async function findNearestHelpers(
  point: GeoPoint,
  radiusKm = 5,
  limit = 10,
): Promise<NearestHelper[]> {
  try {
    const { data, error } = await supabase.rpc('nearest_helpers', {
      lat: point.latitude,
      lng: point.longitude,
      radius_km: radiusKm,
      limit_count: limit,
    });
    if (error) throw error;
    if (!data) return [];
    return (data as NearestHelperRow[]).map((row) => ({
      userId: row.user_id,
      name: row.name ?? 'Helper',
      photoUrl: row.photo_url,
      rating: Number(row.rating ?? 5),
      distanceMeters: Number(row.distance_m ?? 0),
      location: { latitude: row.lat_h, longitude: row.lng_h },
    }));
  } catch (err) {
    console.warn('[helpers] rpc failed, falling back to table scan', err);
    return tableScanNearest(point, radiusKm, limit);
  }
}

async function tableScanNearest(
  point: GeoPoint,
  radiusKm: number,
  limit: number,
): Promise<NearestHelper[]> {
  const { data, error } = await supabase
    .from('helpers_live')
    .select('user_id, lat, lng, rating, profiles!inner(name, photo_url, id_verification)')
    .eq('is_online', true)
    .eq('profiles.id_verification', 'verified')
    .limit(200);
  if (error || !data) return [];
  return (data as unknown as RawJoinRow[])
    .map((row) => ({
      userId: row.user_id,
      name: row.profiles.name ?? 'Helper',
      photoUrl: row.profiles.photo_url,
      rating: Number(row.rating ?? 5),
      distanceMeters: haversineMeters(point, {
        latitude: row.lat,
        longitude: row.lng,
      }),
      location: { latitude: row.lat, longitude: row.lng },
    }))
    .filter((h) => h.distanceMeters <= radiusKm * 1000)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

type NearestHelperRow = {
  user_id: string;
  name: string | null;
  photo_url: string | null;
  rating: number;
  distance_m: number;
  lat_h: number;
  lng_h: number;
};

type RawJoinRow = {
  user_id: string;
  lat: number;
  lng: number;
  rating: number;
  profiles: {
    name: string | null;
    photo_url: string | null;
    id_verification: string;
  };
};
