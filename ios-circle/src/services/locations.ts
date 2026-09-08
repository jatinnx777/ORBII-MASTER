import { supabase } from './supabase';

/**
 * Where the people in your circles are.
 *
 * This app was written before sql/118 to sql/123 existed and knew none of it.
 * Those migrations added the four things that decide whether a pin on a map
 * means anything, and an app whose whole job is answering an alarm should lead
 * with all four:
 *
 *   emergency    the row is released by an ACTIVE SOS rather than by a sharing
 *                setting, which is the case this app exists for
 *   ageSeconds   how old the fix is, worked out server-side
 *   unreachable  sharing is on and nothing has arrived for 20 minutes
 *   precisionM   she chose to share a neighbourhood, not a point
 *
 * Without them a pin from forty minutes ago is drawn identically to one from
 * now, and somebody drives to the wrong place.
 */

export type MemberLocation = {
  userId: string;
  name: string | null;
  photoUri: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
  battery: number | null;
  charging: boolean | null;
  speedKmh: number | null;
  accuracyM: number | null;
  sharing: boolean;
  /** Visible because of an SOS, not because sharing is on. Never call this sharing. */
  emergency: boolean;
  ageSeconds: number;
  unreachable: boolean;
  /** Radius in metres when she reduced her precision, else null for exact. */
  precisionM: number | null;
};

export async function getMemberLocations(): Promise<MemberLocation[]> {
  const { data, error } = await supabase.rpc('circle_members_locations');
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    name: (r.name as string) ?? null,
    photoUri: (r.photo_url as string) ?? null,
    lat: r.lat as number,
    lng: r.lng as number,
    updatedAt: r.updated_at as string,
    battery: typeof r.battery === 'number' ? (r.battery as number) : null,
    charging: typeof r.charging === 'boolean' ? (r.charging as boolean) : null,
    // Both platforms report an unknown speed as a negative number. Passing
    // that through as 0 would say "stationary" about a phone that never told
    // anyone anything.
    speedKmh: typeof r.speed_kmh === 'number' && r.speed_kmh >= 0 ? (r.speed_kmh as number) : null,
    accuracyM: typeof r.accuracy_m === 'number' ? (r.accuracy_m as number) : null,
    sharing: r.sharing !== false,
    // Each defaults to the SAFE reading if the server predates the migration
    // that added it: no emergency, and not unreachable. Age falls back to
    // being computed here rather than reported as zero, because zero means
    // "just now" and that is the one wrong answer that matters.
    emergency: r.emergency === true,
    ageSeconds:
      typeof r.age_seconds === 'number'
        ? (r.age_seconds as number)
        : Math.max(0, Math.round((Date.now() - Date.parse(r.updated_at as string)) / 1000)),
    unreachable: r.unreachable === true,
    precisionM: typeof r.precision_m === 'number' ? (r.precision_m as number) : null,
  }));
}

/** One person, or null if they are not in the roster this call returned. */
export async function getMemberLocation(userId: string): Promise<MemberLocation | null> {
  const all = await getMemberLocations();
  return all.find((m) => m.userId === userId) ?? null;
}

// Re-exported so callers keep one import path. The implementations live in
// ../lib/format because they are pure and this module is not.
export {
  ago,
  describeLocation,
  formatDistance,
  haversineM,
} from '../lib/format';
