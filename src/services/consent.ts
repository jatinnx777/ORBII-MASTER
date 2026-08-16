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

const DOB_KEY = 'orbii.consent.dob';

/**
 * Three states, not two. This distinction matters: everyone who signed up
 * before the date-of-birth field existed has no stored age, and treating that
 * as "under 18" locked adults out of their own location sharing. Unknown means
 * "we have not asked yet", so ask once and remember the answer.
 */
export type AgeStatus = 'adult' | 'minor' | 'unknown';

export async function getAgeStatus(): Promise<AgeStatus> {
  try {
    const flag = await AsyncStorage.getItem(ADULT_KEY);
    if (flag === '1') return 'adult';
    if (flag === '0') return 'minor';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The stored date of birth, 'YYYY-MM-DD', if we have ever been told. */
export async function getStoredDob(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(DOB_KEY);
  } catch {
    return null;
  }
}

/** Whole years between a date of birth and today, or null if the date is junk. */
export function ageFromDob(day: number, month: number, year: number): number | null {
  const now = new Date();
  if (!day || !month || !year) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() < month - 1 || (now.getMonth() === month - 1 && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Store a declared date of birth once, and derive the adult flag from it, so we
 * never have to ask the same person twice. Returns the resulting status.
 */
export async function setDeclaredDob(day: number, month: number, year: number): Promise<AgeStatus> {
  const age = ageFromDob(day, month, year);
  if (age === null || age < 0 || age >= 120) return 'unknown';
  const adult = age >= 18;
  try {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    await AsyncStorage.setItem(DOB_KEY, iso);
    await AsyncStorage.setItem(ADULT_KEY, adult ? '1' : '0');
  } catch {
    /* non-fatal */
  }
  void logConsentEvent('core', true, { method: 'dob' });
  return adult ? 'adult' : 'minor';
}

/**
 * True only when the user has actually told us they are 18 or older. Prefer
 * getAgeStatus() at a gate, so "we have not asked yet" can prompt rather than
 * silently deny. Core safety is never gated on age: refusing to protect a
 * 17 year old would be the worse outcome.
 */
export async function isDeclaredAdult(): Promise<boolean> {
  return (await getAgeStatus()) === 'adult';
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
