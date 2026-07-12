import { supabase } from './supabase';
import { getItem, setItem, removeItem, storageKeys } from './storage';

// Audit log of background Voice SOS sessions (voice_sos_sessions, sql/40) — the
// on/off history of a user's protection, kept for ORBII's legal record.
//
// All calls are fire-and-forget and fail-safe: logging must NEVER block or break
// arming protection. We cache the current session's row id locally so that when
// protection stops we can close the same row.

/** Record that background protection was just armed. Returns nothing; stores the
 *  new row's id locally so a later stop can close it. */
export async function logVoiceSessionStart(
  durationHours: number,
  whisper: boolean,
): Promise<void> {
  try {
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return;
    const startedAt = new Date();
    const expiresAt =
      durationHours > 0
        ? new Date(startedAt.getTime() + durationHours * 3600_000).toISOString()
        : null;
    const { data, error } = await supabase
      .from('voice_sos_sessions')
      .insert({
        user_id: uid,
        started_at: startedAt.toISOString(),
        duration_hours: durationHours > 0 ? durationHours : null,
        expires_at: expiresAt,
        whisper,
      })
      .select('id')
      .single();
    if (error || !data?.id) return;
    await setItem(storageKeys.voiceSessionId, data.id as string);
  } catch {
    // best-effort audit log — never let it affect protection
  }
}

/** Close the currently-open session row (manual stop / sign-out). */
export async function logVoiceSessionEnd(
  reason: 'manual' | 'signed_out',
): Promise<void> {
  try {
    const id = await getItem<string>(storageKeys.voiceSessionId);
    if (!id) return;
    await supabase
      .from('voice_sos_sessions')
      .update({ ended_at: new Date().toISOString(), ended_reason: reason })
      .eq('id', id)
      .is('ended_at', null);
    await removeItem(storageKeys.voiceSessionId);
  } catch {
    // best-effort
  }
}

/** On launch, close out any session whose timer has lapsed while we weren't
 *  looking, so the log reflects the natural expiry the native service performed. */
export async function reconcileExpiredVoiceSessions(): Promise<void> {
  try {
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return;
    await supabase
      .from('voice_sos_sessions')
      .update({ ended_at: new Date().toISOString(), ended_reason: 'expired' })
      .eq('user_id', uid)
      .is('ended_at', null)
      .not('expires_at', 'is', null)
      .lt('expires_at', new Date().toISOString());
  } catch {
    // best-effort
  }
}
