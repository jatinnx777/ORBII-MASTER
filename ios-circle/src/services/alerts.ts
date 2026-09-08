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

// Implementations in ../lib/alertText, which imports nothing.
export { describeAlert, minutesSince, titleFor, triggerNote } from '../lib/alertText';
