import type { UserProfile } from '@/types';
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
  const sent = await sendSosSmsDirect(contacts, message);
  return { sent, needsComposer: !sent, contacts: count };
}

/** Fallback for the caller: open the composer with the same message. */
export async function openDisasterComposer(
  status: DisasterStatus,
  user: UserProfile,
  location: { latitude: number; longitude: number } | null,
): Promise<boolean> {
  return openSMSComposer(user.emergencyContacts ?? [], statusMessage(status, user, location));
}
