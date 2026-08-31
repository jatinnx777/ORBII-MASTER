import { supabase } from './supabase';

/**
 * "SOS sent" is not "help is coming".
 *
 * ORBII used to close that gap by asking HER, at 90 seconds with nobody
 * accepted, to call 112. She is the person least able to make a phone call: she
 * may be hiding, restrained, unable to speak, or holding a phone she dare not
 * look at. The pipeline reached its most important moment and handed the work
 * back to the one person who could not do it.
 *
 * The escalation belongs with the people who CAN act, and it has to be claimed
 * out loud. Four people seeing "somebody should call 112" is four people
 * assuming somebody else did, which is the best documented failure in emergency
 * response, and software makes it worse by showing everyone the same screen at
 * the same instant.
 *
 * So: one person claims it, everyone sees who. And releasing is as easy as
 * claiming, because a claim nobody can drop becomes a lie that stops the others
 * acting.
 */

export type EscalationAction = 'calling_112' | 'going_there' | 'reached';

export type EscalationClaim = {
  action: EscalationAction;
  name: string;
  claimed_by: string;
  at: string;
  is_me: boolean;
};

/**
 * Take responsibility for one action.
 *
 * `also` names anyone who already claimed the same thing. Two people calling
 * 112 is harmless; two people each believing they are the only one is not, so
 * this reports rather than blocks.
 */
export async function claimEscalation(
  sosId: string,
  action: EscalationAction,
): Promise<{ ok: boolean; also?: string | null }> {
  const { data, error } = await supabase.rpc('claim_sos_escalation', {
    p_sos: sosId,
    p_action: action,
  });
  if (error) return { ok: false };
  const r = (data ?? {}) as { ok?: boolean; also?: string | null };
  return { ok: r.ok === true, also: r.also ?? null };
}

export async function releaseEscalation(
  sosId: string,
  action: EscalationAction,
): Promise<boolean> {
  const { error } = await supabase.rpc('release_sos_escalation', {
    p_sos: sosId,
    p_action: action,
  });
  return !error;
}

export async function getEscalationState(sosId: string): Promise<EscalationClaim[]> {
  const { data, error } = await supabase.rpc('sos_escalation_state', { p_sos: sosId });
  if (error || !Array.isArray(data)) return [];
  return data as EscalationClaim[];
}

/** Plain sentences, because this is read under stress by someone who is not calm. */
export function describeClaim(c: EscalationClaim): string {
  const who = c.is_me ? 'You are' : `${c.name} is`;
  switch (c.action) {
    case 'calling_112':
      return `${who} calling 112`;
    case 'going_there':
      return `${who} on the way`;
    case 'reached':
      return c.is_me ? 'You have reached her' : `${c.name} has reached her`;
    default:
      return `${who} helping`;
  }
}
