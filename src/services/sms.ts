import * as SMS from 'expo-sms';
import { NativeModules, Platform } from 'react-native';
import type { EmergencyContact } from '@/types';

const { OrbiiSms } = NativeModules as {
  OrbiiSms?: { sendSms(numbers: string[], message: string): Promise<number> };
};

function contactPhones(contacts: EmergencyContact[]): string[] {
  return contacts.map((c) => c.phone).filter((p) => !!p && p.trim().length >= 7);
}

// SEND_SMS is intentionally NOT declared in the manifest (Play-restricted),
// so hands-free auto-send is disabled and every SMS goes through the composer
// (openSMSComposer) which needs no permission. These stay as no-ops so callers
// never prompt for a permission the app doesn't hold.
/** Always false: hands-free SMS is off for the Play build. */
export async function hasSmsPermission(): Promise<boolean> {
  return false;
}

/** No-op: we never request the restricted SEND_SMS permission. */
export async function requestSmsPermission(): Promise<boolean> {
  return false;
}

/**
 * Hands-free SMS: send directly (no tap) if SEND_SMS is already granted. Returns
 * true if it went out natively. Never prompts here (that would block an SOS), so
 * grant the permission ahead of time. Falls back to the composer only if asked.
 */
export async function sendSosSmsDirect(
  contacts: EmergencyContact[],
  message: string,
): Promise<boolean> {
  const phones = contactPhones(contacts);
  if (phones.length === 0) return false;
  if (Platform.OS === 'android' && OrbiiSms && (await hasSmsPermission())) {
    try {
      const n = await OrbiiSms.sendSms(phones, message);
      return n > 0;
    } catch {
      return false;
    }
  }
  return false;
}

// SMS fallback via the system composer (expo-sms). Pre-fills the SOS message +
// live-location link to every emergency contact; the user taps send once. This
// needs NO special permission, so it's Play-Store safe (unlike SEND_SMS
// auto-send, which Google's SMS policy rejects for non-default-handler apps).
//
// Returns true if the composer was opened.

export async function isSmsComposerAvailable(): Promise<boolean> {
  try {
    return await SMS.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function openSMSComposer(
  contacts: EmergencyContact[],
  message: string,
): Promise<boolean> {
  const phones = contacts
    .map((c) => c.phone)
    .filter((p) => !!p && p.trim().length >= 7);
  if (phones.length === 0) return false;
  try {
    if (!(await SMS.isAvailableAsync())) return false;
    await SMS.sendSMSAsync(phones, message);
    return true;
  } catch {
    return false;
  }
}
