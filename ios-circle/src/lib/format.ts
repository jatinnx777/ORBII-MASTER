/**
 * The pure half of the location layer: formatting and geometry, no network.
 *
 * SPLIT OUT SO IT CAN BE TESTED. These functions decide the sentences somebody
 * reads while working out whether to get in a car, and every one of them was
 * previously unreachable by a test: they sat in a module that imports the
 * Supabase client, which pulls in react-native, which is Flow-typed and cannot
 * be parsed by the test runner.
 *
 * Nothing in this file imports anything. That is the point, and it is also
 * where formatting logic belonged anyway.
 */

import type { MemberLocation } from '../services/locations';

export function ago(seconds: number): string {
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

/**
 * One sentence about a position, and how loudly to say it.
 *
 * Highest-priority true statement and only one, in the order that decides what
 * the reader does next.
 */
export function describeLocation(m: MemberLocation): { text: string; loud: boolean } {
  if (m.emergency) {
    return { text: `Live, during the emergency · ${ago(m.ageSeconds)}`, loud: true };
  }
  if (m.unreachable) {
    return { text: `Not updating · last seen ${ago(m.ageSeconds)}`, loud: true };
  }
  if (!m.sharing) {
    return { text: `Location off · last seen ${ago(m.ageSeconds)}`, loud: false };
  }
  if (m.precisionM != null) {
    const r = m.precisionM >= 1000 ? `${(m.precisionM / 1000).toFixed(1)} km` : `${m.precisionM} m`;
    // Said out loud, because a blurred pin is drawn the same as an exact one
    // and somebody would otherwise navigate to the centre of a cell.
    return { text: `Approximate, within ${r} · ${ago(m.ageSeconds)}`, loud: false };
  }
  return { text: ago(m.ageSeconds), loud: false };
}

/**
 * Metres between two points, on a sphere.
 *
 * Good to a fraction of a percent at city distances, which is far better than
 * this is used for: the number on screen is rounded to a tenth of a kilometre
 * and it exists to answer "am I the closest" rather than to navigate by.
 */
export function haversineM(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const p = Math.PI / 180;
  const dLat = (b.lat - a.lat) * p;
  const dLng = (b.lng - a.lng) * p;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(a.lat * p) * Math.cos(b.lat * p) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m away` : `${(m / 1000).toFixed(1)} km away`;
}
