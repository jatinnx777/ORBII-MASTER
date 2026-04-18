import type { GeoPoint } from '@/types';

// Returns a count of verified helpers within `radiusKm` of the given point.
//
// TODO: when Firestore is wired, replace with a geo-query:
//   collection('users').where('isHelper', '==', true)
//     .where('isOnline', '==', true)
//     [geohash range around point]
//
// For now we return a deterministic-but-believable number based on the time
// of day so demos feel alive without any backend.
export async function countHelpersNearby(
  _point: GeoPoint,
  _radiusKm = 2,
): Promise<number> {
  await delay(250);
  const hourOfDay = new Date().getHours();
  const base = 18;
  const dayBoost = hourOfDay >= 8 && hourOfDay <= 22 ? 10 : -4;
  const jitter = Math.floor(Math.random() * 5);
  return Math.max(3, base + dayBoost + jitter);
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
