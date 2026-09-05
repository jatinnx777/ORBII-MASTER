import { supabase } from './supabase';

/**
 * Check-in and the circle feed.
 *
 * WHAT A CHECK-IN IS FOR. Until now the only way to tell a circle you were
 * fine was to leave live location sharing on and hope somebody looked at the
 * map. That is a bad trade: a permanent stream of her position in exchange for
 * one sentence she wanted to send once. A check-in is that sentence.
 *
 * WHY LOCATION IS OPTIONAL. "I am safe" and "I am safe, and here is exactly
 * where" are different messages, and only one of them is always wanted. A
 * check-in from somewhere she does not want to name is still worth sending.
 *
 * THIS IS NOT CHAT. ORBII removed offline chat and direct messages in August
 * 2026, deliberately. The feed is a list of events the system itself
 * generated: check-ins, arrivals, emergencies. It has no typing indicator, no
 * read receipts and no threading, and the 140 character note below is the only
 * free-text surface in it. Reopening messaging is a decision to make on its
 * own merits, not one to absorb into this file.
 */

export type FeedEntryKind = 'checkin' | 'arrival' | 'sos';

export type FeedEntry = {
  kind: FeedEntryKind;
  /** Milliseconds since epoch. */
  at: number;
  userId: string;
  name: string | null;
  photoUri: string | null;
  /** Already worded by the server, so every client says the same thing. */
  body: string;
  lat: number | null;
  lng: number | null;
  /** The row this came from, where there is one. Null for an SOS. */
  ref: string | null;
};

/** Longest note a check-in may carry. Matches the CHECK constraint in sql/122. */
export const NOTE_MAX = 140;

export type CheckInInput = {
  circleId: string;
  /** Both or neither. A latitude with no longitude is a bug, not a partial answer. */
  lat?: number | null;
  lng?: number | null;
  /** Resolved on the device, because reverse geocoding server-side is an HTTP call inside a transaction. */
  place?: string | null;
  note?: string | null;
};

/**
 * Send a check-in.
 *
 * Returns the new row's id, or null if it did not go through. The server
 * enforces circle membership and a rate limit of six an hour, so the failure
 * modes are "you left that circle" and "you are tapping too fast", neither of
 * which deserves a crash.
 */
export async function checkIn(input: CheckInInput): Promise<string | null> {
  const hasPoint = typeof input.lat === 'number' && typeof input.lng === 'number';
  const { data, error } = await supabase.rpc('circle_check_in', {
    p_circle: input.circleId,
    p_lat: hasPoint ? input.lat : null,
    p_lng: hasPoint ? input.lng : null,
    p_place: input.place ?? null,
    // Trimmed and clipped here as well as in the database. The constraint is
    // the guarantee; this is so a long note is shortened rather than rejected
    // after she has already typed it.
    p_note: input.note ? input.note.trim().slice(0, NOTE_MAX) : null,
  });
  if (error) return null;
  return typeof data === 'string' ? data : null;
}

/** Read a circle's feed, newest first. Empty on any failure, including a circle you have left. */
export async function loadFeed(circleId: string, limit = 40): Promise<FeedEntry[]> {
  const { data, error } = await supabase.rpc('circle_feed', {
    p_circle: circleId,
    p_limit: limit,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    kind: (r.kind as FeedEntryKind) ?? 'checkin',
    at: Date.parse(r.at as string),
    userId: r.user_id as string,
    name: (r.name as string) ?? null,
    photoUri: (r.photo_url as string) ?? null,
    body: (r.body as string) ?? '',
    lat: typeof r.lat === 'number' ? (r.lat as number) : null,
    lng: typeof r.lng === 'number' ? (r.lng as number) : null,
    ref: (r.ref as string) ?? null,
  }));
}

/**
 * Set how precisely your position is shared with your circles.
 *
 * `null` means exact, which is the default and what everyone has today.
 * Anything else is a radius in metres: the server snaps your position to a
 * cell of that size before the row leaves the database (sql/123), so the exact
 * coordinate never crosses the wire at all.
 *
 * An active SOS ignores this entirely and reports your true position. A
 * neighbourhood is not useful to somebody trying to reach you.
 */
export async function setLocationPrecision(metres: number | null): Promise<boolean> {
  const { error } = await supabase.rpc('set_location_precision', { p_metres: metres });
  return !error;
}

/**
 * The radii offered in the UI.
 *
 * Deliberately coarse and few. A slider from 100 to 5000 metres invites people
 * to fiddle with a number whose consequences they cannot see; three named
 * choices with a plain description of each is a decision somebody can actually
 * make.
 */
export const PRECISION_OPTIONS: { metres: number | null; label: string; detail: string }[] = [
  {
    metres: null,
    label: 'Exact',
    detail: 'Your circle sees where you are, to within a few metres.',
  },
  {
    metres: 500,
    label: 'This street',
    detail: 'Roughly which block you are on. Enough to know you got home.',
  },
  {
    metres: 2000,
    label: 'This neighbourhood',
    detail: 'The part of town you are in, and nothing narrower.',
  },
];
