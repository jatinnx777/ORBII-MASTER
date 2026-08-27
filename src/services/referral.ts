import { NativeModules, Platform } from 'react-native';
import { supabase } from './supabase';
import { getItem, setItem, removeItem } from './storage';

/**
 * Campus ambassador attribution.
 *
 * Three routes in, one route out.
 *
 *   1. Play Install Referrer. Somebody taps orbii.app/ref/SRMS01 on a poster,
 *      goes to the Play Store, installs, and opens the app whenever they get
 *      round to it. The referrer string survives that gap; a deep link does not,
 *      because a deep link needs the app to already be installed.
 *   2. A code typed on the profile setup screen. Covers sideloads, a shared
 *      APK, and anybody who searched the store instead of tapping the link.
 *   3. Nothing, which is the common case and must cost the user nothing.
 *
 * NOTHING HERE MAY BLOCK SIGNUP. Every function swallows its own failures and
 * returns a neutral value. The person on the other side of this code is setting
 * up a safety app, and a marketing attribution is not allowed to be in her way.
 */

const KEY = 'orbii:referral-code';
const CHECKED_KEY = 'orbii:referral-checked';

type ReferrerNative = { getInstallReferrer(): Promise<string> };

function native(): ReferrerNative | undefined {
  // Looked up per call rather than captured at import. Under the new
  // architecture a TurboModule is created on first property access, so binding
  // at module scope can freeze in undefined if this file is imported early.
  return (NativeModules as { OrbiiReferrer?: ReferrerNative }).OrbiiReferrer;
}

/**
 * Pull the code out of a Play referrer string.
 *
 * Play hands back the raw `referrer` query parameter, which is usually
 * URL-encoded and may carry other keys if a campaign ever adds them:
 *
 *   ref%3DSRMS01                      -> SRMS01
 *   utm_source%3Dposter%26ref%3DSRMS01 -> SRMS01
 *   SRMS01                             -> SRMS01
 *
 * Anything that does not look like one of our codes is discarded rather than
 * guessed at, because binding a user to a code that does not exist is worse
 * than binding them to nothing.
 */
export function parseReferrer(raw: string): string | null {
  if (!raw) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Malformed percent-encoding. Fall through and try the raw string.
  }

  const keyed = /(?:^|[?&])ref=([^&\s]+)/i.exec(decoded);
  const candidate = keyed ? keyed[1] : decoded.trim();
  return normaliseCode(candidate);
}

/**
 * The code as the database stores it.
 *
 * sql/97 forbids O and I in a code so nobody has to tell them from 0 and 1 while
 * reading a poster in a corridor. Anything containing them is not one of ours.
 */
export function normaliseCode(input: string): string | null {
  const code = (input ?? '').trim().toUpperCase();
  return /^[A-HJ-NP-Z0-9]{4,12}$/.test(code) ? code : null;
}

/**
 * Read the install referrer once per install, then never again.
 *
 * Guarded by a flag rather than by "is the stored code empty", because the
 * common outcome is no referrer at all, and without the flag every cold start
 * would reconnect to the Play service for nothing.
 */
export async function captureInstallReferrer(): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  try {
    if (await getItem<boolean>(CHECKED_KEY)) return getStoredCode();

    const mod = native();
    if (!mod?.getInstallReferrer) {
      await setItem(CHECKED_KEY, true);
      return null;
    }

    const raw = await mod.getInstallReferrer();
    await setItem(CHECKED_KEY, true);

    const code = parseReferrer(raw ?? '');
    if (code) {
      await setItem(KEY, code);
      console.log('[referral] captured from install referrer');
    }
    return code;
  } catch (err) {
    console.warn('[referral] install referrer unavailable', err);
    // Mark as checked anyway. A retry loop on every launch is worse than
    // missing one attribution.
    try {
      await setItem(CHECKED_KEY, true);
    } catch {
      // ignore
    }
    return null;
  }
}

/** Whatever we captured or the user typed, still unbound. */
export async function getStoredCode(): Promise<string | null> {
  try {
    const v = await getItem<string>(KEY);
    return v ? normaliseCode(v) : null;
  } catch {
    return null;
  }
}

export async function setStoredCode(code: string | null): Promise<void> {
  try {
    const norm = code ? normaliseCode(code) : null;
    if (norm) await setItem(KEY, norm);
    else await removeItem(KEY);
  } catch {
    // ignore
  }
}

export type CodeCheck = { valid: boolean; college?: string };

/**
 * Is this a real code? For the tick next to the input.
 *
 * Returns only validity and a college name. Deliberately never the ambassador's
 * name or id: a stranger must not be able to enumerate who our ambassadors are
 * by trying codes, and the college is enough for somebody to spot a typo.
 */
export async function checkCode(code: string): Promise<CodeCheck> {
  const norm = normaliseCode(code);
  if (!norm) return { valid: false };
  try {
    const { data, error } = await supabase.rpc('ambassador_code_exists', { p_code: norm });
    if (error || !data) return { valid: false };
    const r = data as { valid?: boolean; college?: string };
    return { valid: r.valid === true, college: r.college };
  } catch {
    return { valid: false };
  }
}

export type BindResult = { ok: boolean; reason?: string; college?: string };

/**
 * Bind the signed-in user to an ambassador. Call AFTER the account exists.
 *
 * Never throws, never rejects, and the caller is expected to ignore the result.
 * A wrong code is a typo, not a fault: the user sees nothing either way, because
 * telling somebody mid-onboarding that their friend's code did not work is a
 * problem they cannot fix and did not ask about.
 *
 * The stored code is cleared on a definitive outcome, so a reinstall on the same
 * phone does not try to re-bind an account that is already attributed.
 */
export async function bindReferral(explicitCode?: string): Promise<BindResult> {
  try {
    const code = normaliseCode(explicitCode ?? '') ?? (await getStoredCode());
    if (!code) return { ok: false, reason: 'empty' };

    const source = explicitCode ? 'signup_code' : 'deep_link';
    const { data, error } = await supabase.rpc('ambassador_bind_referral', {
      p_code: code,
      p_source: source,
      p_device_hash: null,
    });

    if (error) {
      console.warn('[referral] bind failed, leaving code for a later retry', error);
      return { ok: false, reason: 'network' };
    }

    const r = (data ?? {}) as BindResult;
    // Clear on anything conclusive. 'network' is the only reason worth keeping
    // the code around for, and it does not reach here.
    await setStoredCode(null);
    if (r.ok) console.log('[referral] bound to an ambassador');
    return { ok: r.ok === true, reason: r.reason, college: r.college };
  } catch (err) {
    console.warn('[referral] bind threw', err);
    return { ok: false, reason: 'error' };
  }
}
