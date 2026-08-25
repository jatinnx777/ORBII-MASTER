import { supabase } from './supabase';

/**
 * Epoch-aware topic names for the live SOS channels.
 *
 * WHY THIS EXISTS. Supabase Realtime evaluates the policies in sql/39 when a
 * client JOINS a topic, not per frame. So tightening orbii_can_access_sos
 * (sql/88) stops a removed circle member from joining, but does not close a
 * socket they already had open when they were removed.
 *
 * The epoch moves the conversation somewhere they cannot follow. It is appended
 * to the topic, revoking bumps it, and both sides hop. The stale socket stays
 * open on the old topic and hears nothing, because nobody is publishing there.
 *
 * THE SERVER IS THE ONLY SOURCE OF TRUTH, deliberately. Both sides poll
 * orbii_sos_channel_epoch and converge on whatever it returns. An earlier design
 * had the publisher announce a hop in-band on the topic it was leaving, which is
 * faster, but a subscriber that misses the announcement is blinded permanently.
 * Polling is slower to converge and cannot fail that way: worst case both sides
 * are briefly on different topics and recover on the next tick.
 *
 * That trade is the right way round here. A responding helper losing the
 * victim's position is a far worse outcome than a revoked member keeping a dead
 * socket open for another twenty seconds.
 */

/**
 * OFF BY DEFAULT.
 *
 * The residual risk this closes is small: topics are per-SOS, so a stale socket
 * can only follow the one SOS that was already running at the moment its owner
 * was removed. Every later SOS is a new topic, a new join, and is fully
 * protected by sql/88 on its own.
 *
 * Against that, this adds a moving part to the most safety-critical transport in
 * the app. Turn it on once it has been exercised on real hardware through a
 * complete SOS, not before.
 */
export const SOS_CHANNEL_EPOCH_ENABLED = false;

/** How often both sides re-read the epoch while an SOS is live. */
export const EPOCH_POLL_MS = 20_000;

export type SosChannelKind = 'sos-victim' | 'sos-live';

/**
 * Last epoch seen per SOS.
 *
 * A failed lookup returns the cached value rather than 0. Falling back to 0 (the
 * bare topic) on a network blip would put one side on the base topic while the
 * other is on epoch 3, and they would not see each other until the next poll.
 * Holding the last known good value keeps both sides where they already agreed
 * to be.
 */
const cache = new Map<string, number>();

export async function resolveEpoch(sosId: string): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('orbii_sos_channel_epoch', {
      p_sos: sosId,
    });
    if (error) throw error;
    const n = Number(data);
    if (!Number.isFinite(n) || n < 0) throw new Error('implausible epoch');
    cache.set(sosId, n);
    return n;
  } catch {
    return cache.get(sosId) ?? 0;
  }
}

/**
 * Epoch 0 is the bare topic, which is what every existing build already uses and
 * what the overwhelming majority of SOS events will use forever, since it means
 * nobody has ever been removed from any circle she belongs to. Old and new
 * clients therefore meet on the same topic in the normal case.
 */
export function topicFor(kind: SosChannelKind, sosId: string, epoch: number): string {
  return epoch > 0 ? `${kind}:${sosId}:${epoch}` : `${kind}:${sosId}`;
}

export function forgetEpoch(sosId: string): void {
  cache.delete(sosId);
}

/**
 * Watch the epoch for an SOS and call back when it changes.
 *
 * Returns a stop function. Never throws: if the RPC is missing because sql/88
 * has not been applied, resolveEpoch returns the cached 0 and this quietly does
 * nothing, which is exactly the pre-epoch behaviour.
 */
export function watchEpoch(
  sosId: string,
  current: number,
  onChange: (epoch: number) => void,
): () => void {
  if (!SOS_CHANNEL_EPOCH_ENABLED) return () => undefined;
  let seen = current;
  let stopped = false;
  const timer = setInterval(() => {
    void resolveEpoch(sosId).then((next) => {
      if (stopped || next === seen) return;
      seen = next;
      onChange(next);
    });
  }, EPOCH_POLL_MS);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
