import * as SMS from 'expo-sms';
import type { EmergencyContact } from '@/types';

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
