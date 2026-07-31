import { supabase } from './supabase';
import { reportError } from './error-reporting';

// Phase C: multi-helper arrival codes (sql/51). Each verified helper gets their
// own 4-digit code; all non-verified helpers share one. The victim's screen
// shows them; each helper submits theirs on arrival. When all are entered the
// SOS auto-resolves server-side.

export type ArrivalCode = {
  kind: 'verified' | 'shared';
  assigneeId: string | null;
  assigneeName: string | null;
  code: string;
  entered: boolean;
  enteredName: string | null;
};

type Row = {
  kind: 'verified' | 'shared';
  assignee_id: string | null;
  assignee_name: string | null;
  code: string;
  entered: boolean;
  entered_name: string | null;
};

/** Victim: mint/refresh and read back the codes for her active SOS. */
export async function mintArrivalCodes(sosId: string): Promise<ArrivalCode[]> {
  try {
    const { data, error } = await supabase.rpc('mint_arrival_codes', { p_sos: sosId });
    if (error) {
      reportError(error, { category: 'arrival.codes', message: 'mint_arrival_codes failed' });
      return [];
    }
    return (data as Row[]).map((r) => ({
      kind: r.kind,
      assigneeId: r.assignee_id ?? null,
      assigneeName: r.assignee_name ?? null,
      code: r.code,
      entered: !!r.entered,
      enteredName: r.entered_name ?? null,
    }));
  } catch (err) {
    reportError(err, { category: 'arrival.codes', message: 'mint_arrival_codes threw' });
    return [];
  }
}

export type SubmitResult =
  | { ok: true; allDone: boolean }
  | { ok: false; wrong: true }
  | { ok: false; wrong: false; error: string };

/** Helper: submit the code read off the victim's screen, with their name. */
export async function submitArrivalCode(
  sosId: string,
  code: string,
  name: string,
): Promise<SubmitResult> {
  try {
    const { data, error } = await supabase.rpc('submit_arrival_code', {
      p_sos: sosId,
      p_code: code,
      p_name: name,
    });
    if (error) {
      reportError(error, { category: 'arrival.codes', message: 'submit_arrival_code failed' });
      return { ok: false, wrong: false, error: error.message };
    }
    const res = (data ?? {}) as { ok?: boolean; wrong?: boolean; all_done?: boolean };
    if (res.ok) return { ok: true, allDone: !!res.all_done };
    if (res.wrong) return { ok: false, wrong: true };
    return { ok: false, wrong: false, error: 'Could not confirm the code.' };
  } catch (err) {
    reportError(err, { category: 'arrival.codes', message: 'submit_arrival_code threw' });
    return { ok: false, wrong: false, error: 'Could not reach the server. Check your connection.' };
  }
}
