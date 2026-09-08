import { supabase } from './supabase';

/**
 * The one question this app exists to answer: is anyone I care about in
 * trouble right now.
 *
 * It is a POLL, not only a push, and that is deliberate. The main ORBII app
 * tells a circle member about an SOS through a notification, which means a
 * phone on silent, a notification swiped away half asleep, or an OEM battery
 * manager killing the app is enough to miss an emergency entirely. A screen
 * you can open and check has no such failure mode.
 */

export type CircleAlert = {
  sos_id: string;
  user_id: string;
  name: string;
  photo_url: string | null;
  lat: number;
  lng: number;
  address: string | null;
  created_at: string;
  /** How many people have accepted. Zero is the number that matters. */
  responders: number;
  /** How many have taken ownership of an action (calling 112, going there). */
  claimed: number;
};

export async function getCircleAlerts(): Promise<CircleAlert[]> {
  const { data, error } = await supabase.rpc('my_circle_active_sos');
  if (error || !Array.isArray(data)) return [];
  return data as CircleAlert[];
}

/** Minutes since the alert was raised, floored, never negative. */
export function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60000));
}

/**
 * The sentence at the top of an alert card.
 *
 * Leads with what is MISSING rather than what has happened. "Alert sent" is
 * the fact a person already knows by the time they are reading this screen.
 * "Nobody has accepted" is the fact that decides whether they get up.
 */
export function describeAlert(a: CircleAlert): string {
  const mins = minutesSince(a.created_at);
  const when = mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`;

  if (a.responders === 0 && a.claimed === 0) {
    return `${when}. Nobody has responded yet.`;
  }
  if (a.responders === 0) {
    return `${when}. Someone has taken this on, nobody has arrived.`;
  }
  const n = a.responders;
  return `${when}. ${n} ${n === 1 ? 'person is' : 'people are'} responding.`;
}
