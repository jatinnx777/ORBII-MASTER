import { supabase } from './supabase';

/**
 * Roll call: one person asks a whole circle "are you safe" at once.
 *
 * The same RPCs the main app calls (sql/107). Worth having here because the
 * person most likely to OPEN a roll call is a parent watching a flood on the
 * news, and a parent is exactly who has this app rather than the full one.
 *
 * The list leads with whoever has NOT answered. In a disaster the replies are
 * reassuring and the silences are the information.
 */

export type RollCallEntry = {
  user_id: string;
  name: string;
  status: 'safe' | 'help' | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
};

export type OpenRollCall = {
  id: string;
  circle_id: string;
  opened_by: string;
};

export async function openRollCall(circleId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('open_roll_call', { p_circle: circleId });
  if (error) return null;
  return (data as string) ?? null;
}

export async function getRollCall(rollCallId: string): Promise<RollCallEntry[]> {
  const { data, error } = await supabase.rpc('roll_call_state', { p_roll_call: rollCallId });
  if (error || !Array.isArray(data)) return [];
  return data as RollCallEntry[];
}

export async function answerRollCall(
  rollCallId: string,
  status: 'safe' | 'help',
  place: string | null = null,
): Promise<boolean> {
  const { error } = await supabase.rpc('answer_roll_call', {
    p_roll_call: rollCallId,
    p_status: status,
    p_lat: null,
    p_lng: null,
    p_place: place,
  });
  return !error;
}

export async function myOpenRollCalls(): Promise<OpenRollCall[]> {
  const { data, error } = await supabase.rpc('my_open_roll_calls');
  if (error || !Array.isArray(data)) return [];
  return data as OpenRollCall[];
}

/** Unanswered first. The silences are the reason the roll call was opened. */
export function unansweredFirst(rows: RollCallEntry[]): RollCallEntry[] {
  return [...rows].sort((a, b) => {
    const rank = (r: RollCallEntry) => (r.status === null ? 0 : r.status === 'help' ? 1 : 2);
    return rank(a) - rank(b);
  });
}
