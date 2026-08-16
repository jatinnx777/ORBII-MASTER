import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// DPDP Act 2023 consent. We record that the user was shown the itemised
// privacy notice, confirmed they are 18 or older, and agreed, with a version
// and language so the record is meaningful if the notice text changes later.
//
// The server copy (user_consent_logs, sql/65) is the evidentiary trail. The
// local flag just lets us avoid re-prompting on this device.

// Bump this whenever the privacy notice materially changes.
export const CONSENT_VERSION = 'dpdp-2026-08';

const LOCAL_KEY = `orbii.consent.${CONSENT_VERSION}`;
const ADULT_KEY = 'orbii.consent.isAdult';

export async function hasLocalConsent(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LOCAL_KEY)) === '1';
  } catch {
    return false;
  }
}

/**
 * Did this user declare they are 18 or older? Used to gate OPTIONAL data
 * collection (the voice-donation programme). Core safety is never gated on this:
 * refusing to protect a 17 year old would be the worse outcome. Defaults to
 * false, so anything optional stays off unless adulthood was actually declared.
 */
export async function isDeclaredAdult(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ADULT_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Purposes we track consent for, one row per purpose (see sql/72). */
export type ConsentPurpose =
  | 'core'
  | 'location_share'
  | 'location_history'
  | 'voice_sos'
  | 'voice_donation'
  | 'notifications';

/**
 * Append one consent decision to the audit ledger (sql/72). Every grant AND
 * every withdrawal gets a row, because under the DPDP Rules we have to be able
 * to show what a person agreed to, when, and against which version of the
 * notice. Never throws: a failed audit write must not block safety setup, and
 * the local flag still governs behaviour.
 */
export async function logConsentEvent(
  purpose: ConsentPurpose,
  granted: boolean,
  opts: { method?: string; lang?: string } = {},
): Promise<void> {
  try {
    await supabase.rpc('log_consent_event', {
      p_purpose: purpose,
      p_granted: granted,
      p_notice_version: CONSENT_VERSION,
      p_lang: opts.lang ?? 'en',
      p_method: opts.method ?? 'toggle',
      p_is_adult: await isDeclaredAdult(),
      p_device: Platform.OS,
    });
  } catch {
    /* best effort, never block the user */
  }
}

// Records consent locally (always) and server-side (best effort). Never throws:
// a failed audit write must not block a user from finishing safety setup.
export async function recordConsent(lang: string, isAdult: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(LOCAL_KEY, '1');
    await AsyncStorage.setItem(ADULT_KEY, isAdult ? '1' : '0');
  } catch {
    /* non-fatal */
  }
  try {
    await supabase.rpc('log_consent', {
      p_version: CONSENT_VERSION,
      p_lang: lang || 'en',
      // Record what the user actually declared. Hardcoding this to true made the
      // consent log worthless as evidence, which is the whole point of keeping one.
      p_is_adult: isAdult,
    });
  } catch {
    /* best effort, local flag still set, will retry next launch if needed */
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
