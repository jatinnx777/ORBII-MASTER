import { supabase } from './supabase';
import { reportError } from './error-reporting';

// The 4-digit rescue completion code (sql/36).
//
// The victim's screen shows it. The helper, standing in front of her, asks for
// it and types it in. Only a correct code completes the rescue.
//
// The helper can never read the code, he submits a guess to a SECURITY DEFINER
// function that compares it server-side. That's what makes it proof: geofencing
// says his phone was nearby; the code says a human actually spoke to her.

export type VerifyResult =
  | { ok: true }
  | { ok: false; wrong: true }
  | { ok: false; wrong: false; error: string };

/** Victim: fetch (minting on first call) the code for her active SOS. */
export async function ensureSosCode(sosId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc('ensure_sos_code', { p_sos: sosId });
    if (error) {
      reportError(error, {
        category: 'rescue.code',
        message: 'could not mint the rescue code, helper cannot complete the rescue',
        data: { code: error.code, hint: error.hint },
      });
      return null;
    }
    return (data as string) ?? null;
  } catch (err) {
    reportError(err, { category: 'rescue.code', message: 'ensure_sos_code threw' });
    return null;
  }
}

/**
 * Helper: submit the code she read out.
 * A wrong code is a normal outcome (he may have misheard), it changes nothing
 * server-side and he can simply try again.
 */
export async function verifyRescueCode(
  rescueEventId: string,
  code: string,
): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.rpc('verify_rescue_code', {
      p_event: rescueEventId,
      p_code: code,
    });
    if (error) {
      reportError(error, {
        category: 'rescue.code',
        message: 'verify_rescue_code failed',
        data: { code: error.code, hint: error.hint },
      });
      return { ok: false, wrong: false, error: error.message };
    }
    return data === true ? { ok: true } : { ok: false, wrong: true };
  } catch (err) {
    reportError(err, { category: 'rescue.code', message: 'verify_rescue_code threw' });
    return {
      ok: false,
      wrong: false,
      error: 'Could not reach the server. Check your connection.',
    };
  }
}
