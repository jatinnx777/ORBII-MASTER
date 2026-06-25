import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import type { EmergencyContact } from '@/types';

// Direct-SMS fallback for the SOS dispatch. Texts every emergency contact the
// SOS message + live-location link WITHOUT the user tapping send — the point
// being that in a real emergency they may not be able to. Works with no data
// connection and reaches contacts who don't use ORBII.
//
// Requires the SEND_SMS runtime permission. We never prompt for it mid-
// emergency: ensureSmsPermission() is called up-front (when the user manages
// emergency contacts); at SOS time we only send if it's already granted.

const { OrbiiSms } = NativeModules as {
  OrbiiSms?: { sendSms(addresses: string[], body: string): Promise<number> };
};

export const smsSupported = Platform.OS === 'android' && !!OrbiiSms;

export async function isSmsPermitted(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
  } catch {
    return false;
  }
}

/** Ask for SEND_SMS up-front (e.g. on the Emergency Contacts screen). */
export async function ensureSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    if (await isSmsPermitted()) return true;
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'Allow ORBII to text your contacts',
        message:
          'In an emergency, ORBII can text your emergency contacts your location automatically — even with no internet.',
        buttonPositive: 'Allow',
        buttonNegative: 'Not now',
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

/**
 * Text every emergency contact. Returns how many were sent. Sends only if the
 * permission is ALREADY granted (no prompt during an emergency) — call
 * ensureSmsPermission() earlier in the journey.
 */
export async function sendEmergencySMS(
  contacts: EmergencyContact[],
  message: string,
): Promise<number> {
  if (!smsSupported) return 0;
  const phones = contacts.map((c) => c.phone).filter((p) => !!p && p.trim().length >= 7);
  if (phones.length === 0) return 0;
  if (!(await isSmsPermitted())) return 0;
  try {
    return await OrbiiSms!.sendSms(phones, message);
  } catch {
    return 0;
  }
}
