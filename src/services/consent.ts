import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// DPDP Act 2023 consent. We record that the user was shown the itemised
// privacy notice, confirmed they are 18 or older, and agreed — with a version
// and language so the record is meaningful if the notice text changes later.
//
// The server copy (user_consent_logs, sql/65) is the evidentiary trail. The
// local flag just lets us avoid re-prompting on this device.

// Bump this whenever the privacy notice materially changes.
export const CONSENT_VERSION = 'dpdp-2026-08';

const LOCAL_KEY = `orbii.consent.${CONSENT_VERSION}`;

export async function hasLocalConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOCAL_KEY)) === '1';
  } catch {
    return false;
  }
}

// Records consent locally (always) and server-side (best effort). Never throws:
// a failed audit write must not block a user from finishing safety setup.
export async function recordConsent(lang: string): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_KEY, '1');
  } catch {
    /* non-fatal */
  }
  try {
    await supabase.rpc('log_consent', {
      p_version: CONSENT_VERSION,
      p_lang: lang || 'en',
      p_is_adult: true,
    });
  } catch {
    /* best effort — local flag still set, will retry next launch if needed */
  }
}

// Right to erasure (DPDP Section 12). Hard-deletes every row this user owns.
// Returns true on success. Caller signs the user out afterwards.
export async function deleteMyData(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('delete_user_profile_cascade');
    if (error) return false;
    await AsyncStorage.removeItem(LOCAL_KEY);
    return true;
  } catch {
    return false;
  }
}
