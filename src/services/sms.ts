import * as SMS from 'expo-sms';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { EmergencyContact } from '@/types';

const { OrbiiSms } = NativeModules as {
  OrbiiSms?: { sendSms(numbers: string[], message: string): Promise<number> };
};
const SEND_SMS = 'android.permission.SEND_SMS' as never;

function contactPhones(contacts: EmergencyContact[]): string[] {
  return contacts.map((c) => c.phone).filter((p) => !!p && p.trim().length >= 7);
}

/** Is the SEND_SMS permission already granted (no prompt)? */
export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || !OrbiiSms) return false;
  try {
    return await PermissionsAndroid.check(SEND_SMS);
  } catch {
    return false;
  }
}

/** Ask for SEND_SMS (used once, ahead of time, so an offline SOS can auto-text). */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android' || !OrbiiSms) return false;
  try {
    return (await PermissionsAndroid.request(SEND_SMS)) === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
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
