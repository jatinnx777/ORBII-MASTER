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
  /**
   * What set the alarm off (sql/120). Added after this app was written.
   *
   * It changes what the reader should do, which is why it is worth a column.
   * Somebody who pressed a button can usually answer their phone. Somebody
   * whose phone detected a hard impact and then did not respond to a countdown
   * may not be able to, and calling is the wrong first move.
   */
  trigger: SOSTrigger;
};

export type SOSTrigger = 'manual' | 'voice' | 'impact' | 'geofence' | 'disaster';

export async function getCircleAlerts(): Promise<CircleAlert[]> {
  const { data, error } = await supabase.rpc('my_circle_active_sos');
  if (error || !Array.isArray(data)) return [];
  // `trigger` defaults to manual rather than being trusted from the row. A
  // server older than sql/120 does not return the column at all, and the
  // reading that is safe to get wrong is "a person pressed something".
  return (data as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as CircleAlert),
    trigger: (r.trigger as SOSTrigger) ?? 'manual',
  }));
}

/**
 * The headline. What kind of alarm this is, before anything else.
 *
 * A sensor-raised alert and a pressed button are different events and the
 * difference decides the first thirty seconds, which is the only part of this
 * screen that matters.
 */
export function titleFor(a: CircleAlert): string {
  switch (a.trigger) {
    case 'impact':
      return `${a.name} may have had a fall or crash`;
    case 'voice':
      return `${a.name} said the word`;
    case 'geofence':
      return `${a.name} left a safe zone`;
    case 'disaster':
      return `${a.name} raised an alert`;
    default:
      return `${a.name} needs help`;
  }
}

/** The line under the title, when the trigger warrants one. */
export function triggerNote(a: CircleAlert): string | null {
  if (a.trigger === 'impact') {
    return 'Their phone detected a hard impact and they did not respond to the countdown. They may not be able to answer a call.';
  }
  if (a.trigger === 'voice') {
    return 'Raised hands-free, without touching the phone.';
  }
  return null;
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
