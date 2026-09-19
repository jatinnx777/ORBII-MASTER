import { supabase } from './supabase';

/**
 * Home, as a place ORBII knows about.
 *
 * READ BY NOBODY BUT HER. The table has one SELECT policy and it is
 * `auth.uid() = user_id` (sql/138). Her circle cannot read this, an admin
 * cannot read this, another signed-in user cannot read this. If a circle
 * member ever sees her address it is because the app sent it during an event
 * she raised, not because they were in her circle.
 *
 * WHAT IT IS FOR, which is also what the onboarding screen has to say out
 * loud, because DPDP section 6 ties consent to a stated purpose:
 *
 *   1. Arrival. A Safe Journey with no destination can only report that she
 *      stopped moving. With home known it can say she got there.
 *   2. The address a responder is given. A circle member reading an SOS gets
 *      coordinates, and coordinates are not what you read out to a driver, a
 *      guard, or a control room.
 *   3. Seeding a home safe zone, so the first geofence is not a blank map.
 *
 * NOT GEOCODED ON SAVE. We keep the text she typed. Turning it into a
 * coordinate here would quietly create a second copy of where she lives, in a
 * shape that is far easier to search.
 */

export type HomeAddress = {
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string | null;
  pincode: string | null;
};

type Row = {
  line1: string;
  line2: string | null;
  landmark: string | null;
  city: string;
  state: string | null;
  pincode: string | null;
};

function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t.length > 0 ? t : null;
}

/**
 * True when there is enough to be worth storing.
 *
 * A street and a city. Everything else is optional, because an address that
 * insists on a pincode is an address form that a lot of India cannot complete,
 * and a half-filled home is still better than no home for every purpose above.
 */
export function isUsableAddress(a: Partial<HomeAddress>): boolean {
  return (a.line1 ?? '').trim().length >= 4 && (a.city ?? '').trim().length >= 2;
}

/** Her own address, or null. Returns null on any error: this never blocks a screen. */
export async function loadHomeAddress(): Promise<HomeAddress | null> {
  try {
    const { data, error } = await supabase
      .from('home_address')
      .select('line1, line2, landmark, city, state, pincode')
      .maybeSingle();
    if (error || !data) return null;
    const r = data as Row;
    return {
      line1: r.line1,
      line2: r.line2,
      landmark: r.landmark,
      city: r.city,
      state: r.state,
      pincode: r.pincode,
    };
  } catch {
    return null;
  }
}

/**
 * Save or replace it. Returns false rather than throwing.
 *
 * Onboarding must never dead-end on this: it is an optional step, and a
 * network hiccup on a field she could have skipped should not trap her.
 */
export async function saveHomeAddress(input: Partial<HomeAddress>): Promise<boolean> {
  if (!isUsableAddress(input)) return false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) return false;

    const { error } = await supabase.from('home_address').upsert(
      {
        user_id: uid,
        line1: (input.line1 ?? '').trim(),
        line2: clean(input.line2),
        landmark: clean(input.landmark),
        city: (input.city ?? '').trim(),
        state: clean(input.state),
        pincode: clean(input.pincode),
      },
      { onConflict: 'user_id' },
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * Remove it entirely.
 *
 * A single RPC rather than a client-built DELETE, so erasing where she lives is
 * one call and never a support request.
 */
export async function deleteHomeAddress(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('delete_my_home_address');
    return !error;
  } catch {
    return false;
  }
}

/** One line, for reading out. Skips the parts she left blank. */
export function formatAddress(a: HomeAddress): string {
  return [a.line1, a.line2, a.landmark, a.city, a.state, a.pincode]
    .map((p) => (p ?? '').trim())
    .filter((p) => p.length > 0)
    .join(', ');
}
