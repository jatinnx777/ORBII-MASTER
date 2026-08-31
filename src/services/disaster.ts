import type { UserProfile } from '@/types';
import { broadcastMeshStatus } from './mesh';
import { supabase } from './supabase';
import { sendSosSmsDirect, openSMSComposer } from './sms';

// Phase 3: Disaster mode. When floods, landslides or a network shutdown hit, a
// person needs to tell the people they trust one of two things, fast, even
// with no internet: "I need help" or "I'm safe." Both go out as SMS (which
// rides cell signal with data off), so they work when apps and towers are down.
// "I need help" carries a live-location link.

export type DisasterStatus = 'help' | 'safe';

function statusMessage(
  status: DisasterStatus,
  user: UserProfile,
  location: { latitude: number; longitude: number } | null,
): string {
  const name = user.name || 'An ORBII user';
  if (status === 'safe') {
    return `${name} is SAFE. Sent via ORBII disaster mode.`;
  }
  const link = location
    ? ` My location: https://maps.google.com/?q=${location.latitude},${location.longitude}`
    : '';
  return `${name} needs help in an emergency.${link} Sent via ORBII disaster mode.`;
}

export type DisasterResult = { sent: boolean; needsComposer: boolean; contacts: number };

/**
 * Broadcast a disaster status to the user's emergency contacts. Tries the
 * hands-free SMS first (silent if SEND_SMS is granted); if it can't, signals the
 * caller to open the one-tap composer instead.
 */
export async function broadcastDisasterStatus(
  status: DisasterStatus,
  user: UserProfile,
  location: { latitude: number; longitude: number } | null,
): Promise<DisasterResult> {
  const contacts = user.emergencyContacts ?? [];
  const count = contacts.filter((c) => !!c.phone && c.phone.trim().length >= 7).length;
  if (count === 0) return { sent: false, needsComposer: false, contacts: 0 };
  const message = statusMessage(status, user, location);

  // The mesh goes out FIRST and is never awaited on the SMS path. In a disaster
  // the two channels fail for different reasons: SMS dies with the towers, the
  // mesh dies only if there is nobody within Bluetooth range. Sending both, and
  // letting neither block the other, is the whole point.
  if (location) {
    void broadcastMeshStatus(user.uid, status, location.latitude, location.longitude, Date.now())
      .catch(() => undefined);
  }

  const sent = await sendSosSmsDirect(contacts, message);
  return { sent, needsComposer: !sent, contacts: count };
}

/* ------------------------------------------------------------------ */
/* Roll call                                                           */
/* ------------------------------------------------------------------ */

/**
 * Everyone can shout and nobody can hear.
 *
 * Disaster mode could only broadcast, which is backwards: the thing families
 * actually do is find each other, and what they need is not more messages but
 * the list of who has NOT answered.
 *
 * roll_call_state deliberately returns every circle member, replied or not, and
 * orders the silent ones first. The silence is the information.
 */
export type RollCallEntry = {
  user_id: string;
  name: string;
  status: 'safe' | 'help' | null;
  place: string | null;
  lat: number | null;
  lng: number | null;
  answered_at: string | null;
};

export async function openRollCall(circleId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('open_roll_call', { p_circle: circleId });
  if (error) return null;
  return (data as string) ?? null;
}

export async function answerRollCall(
  rollCallId: string,
  status: DisasterStatus,
  location: { latitude: number; longitude: number } | null,
  place: string | null,
): Promise<boolean> {
  const { error } = await supabase.rpc('answer_roll_call', {
    p_roll_call: rollCallId,
    p_status: status,
    p_lat: location?.latitude ?? null,
    p_lng: location?.longitude ?? null,
    p_place: place,
  });
  return !error;
}

export async function getRollCall(rollCallId: string): Promise<RollCallEntry[]> {
  const { data, error } = await supabase.rpc('roll_call_state', { p_roll_call: rollCallId });
  if (error || !Array.isArray(data)) return [];
  return data as RollCallEntry[];
}

export type OpenRollCall = {
  id: string;
  circle_id: string;
  opened_by: string;
  opened_at: string;
  answered: boolean;
};

export async function myOpenRollCalls(): Promise<OpenRollCall[]> {
  const { data, error } = await supabase.rpc('my_open_roll_calls');
  if (error || !Array.isArray(data)) return [];
  return data as OpenRollCall[];
}

/** Fallback for the caller: open the composer with the same message. */
export async function openDisasterComposer(
  status: DisasterStatus,
  user: UserProfile,
  location: { latitude: number; longitude: number } | null,
): Promise<boolean> {
  return openSMSComposer(user.emergencyContacts ?? [], statusMessage(status, user, location));
}
