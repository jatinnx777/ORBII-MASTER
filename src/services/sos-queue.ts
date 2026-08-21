import { getItem, setItem, storageKeys } from './storage';
import { supabase } from './supabase';
import { subscribeConnection } from './net';
import { addBreadcrumb, reportError } from './error-reporting';
import type { SOSRecord, UserProfile } from '@/types';

// Offline SOS queue. If an SOS fires with no connectivity, the realtime
// broadcast and push fan-out can't reach anyone. Rather than lose the alert,
// we persist it locally and replay it (DB upsert + notify-sos push) the moment
// the network comes back, so the circle still gets alerted, just a bit late.
//
// Only used on the OFFLINE path: when online, createSOS sends immediately and
// never enqueues, so there's no double-send.

type QueuedSOS = {
  record: SOSRecord;
  user: Pick<UserProfile, 'uid' | 'name' | 'photoUri'> & { isPremium: boolean };
  queuedAt: number;
  attempts?: number;
  /** Epoch ms before which this item must not be retried. Backoff, persisted. */
  nextAttemptAt?: number;
  /** Set once the row is in Postgres, so a retry never re-fans-out the push. */
  persisted?: boolean;
};

// Drop anything older than this: a 45-minute-late "emergency" push is noise,
// not help, and could alarm the circle long after the moment has passed.
const MAX_AGE_MS = 45 * 60 * 1000;
// Retry cap: a permanently-failing item (bad payload, server rejects it) must
// not loop forever. After this many tries we drop it and report, so it can
// never block the queue behind it.
const MAX_ATTEMPTS = 8;

// Exponential backoff with jitter.
//
// Why this was needed: flushSOSQueue runs at boot and on every NetInfo
// connectivity event, with no spacing between tries. A flapping connection is
// not an edge case here, it is the normal state of the exact situation this
// queue exists for: a phone at the edge of coverage, walking. Android emits a
// connectivity change on every flap, so a failing item was retried on every
// one of them, hammering the server and burning the battery of someone who may
// need it to last.
//
// 1s, 2s, 4s ... capped at 60s. Jitter is ±25% so that a tower coming back and
// waking a thousand phones at once does not produce a synchronised thundering
// herd against the same edge function.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 60_000;

function backoffFor(attempts: number): number {
  const raw = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
  const jitter = raw * 0.25 * (Math.random() * 2 - 1);
  return Math.round(raw + jitter);
}

export async function enqueueSOS(record: SOSRecord, user: UserProfile): Promise<void> {
  try {
    const q = (await getItem<QueuedSOS[]>(storageKeys.sosQueue)) ?? [];
    if (q.some((i) => i.record.id === record.id)) return;
    q.push({
      record,
      user: { uid: user.uid, name: user.name, photoUri: user.photoUri, isPremium: user.isPremium },
      queuedAt: Date.now(),
    });
    await setItem(storageKeys.sosQueue, q);
    addBreadcrumb({ category: 'sos', severity: 'warn', message: 'SOS queued (offline)', data: { id: record.id } });
  } catch (err) {
    reportError(err, { category: 'sos.queue', message: 'enqueueSOS failed' });
  }
}

// Returns the item's new state so the caller can persist partial progress.
//
// The two steps are separated deliberately. The upsert is idempotent: the SOS
// id is the idempotency key and `onConflict: 'id'` means replaying it is a
// no-op. The notify-sos invoke is NOT idempotent, it fans out pushes every
// time it is called. Before this split, an item that persisted successfully
// and then failed on the push invoke was retried whole, and the circle got the
// same emergency alert twice, three times, once per connectivity flap.
//
// So once the row is in Postgres we record that, and a retry resumes at the
// push rather than starting again.
async function deliver(item: QueuedSOS): Promise<{ persisted: boolean }> {
  const { record, user } = item;
  if (item.persisted) {
    await supabase.functions.invoke('notify-sos', { body: { sosId: record.id } });
    return { persisted: true };
  }
  const { error } = await supabase.from('sos_events').upsert(
    {
      id: record.id,
      user_id: user.uid,
      lat: record.location.latitude,
      lng: record.location.longitude,
      address: record.location.address,
      status: 'active',
      kind: record.kind ?? 'real',
      user_name: user.name,
      user_photo: user.photoUri,
      // Must match the online path in sos.ts. This used to be
      // `!user.isPremium`, which meant the SAME emergency was visible to
      // nearby helpers if it sent immediately and hidden from them if it went
      // through the offline queue. The queue is used when there is no network,
      // which is when she is most isolated, so the queued path was the more
      // restrictive of the two. That is backwards.
      circle_only: false,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
  // Mark persisted BEFORE the push, so a failure past this point resumes here.
  item.persisted = true;
  await supabase.functions.invoke('notify-sos', { body: { sosId: record.id } });
  return { persisted: true };
}

let flushing = false;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextFlush(items: QueuedSOS[]): void {
  if (wakeTimer) {
    clearTimeout(wakeTimer);
    wakeTimer = null;
  }
  const due = items
    .map((i) => i.nextAttemptAt ?? 0)
    .filter((t) => t > Date.now());
  if (due.length === 0) return;
  const delay = Math.max(250, Math.min(...due) - Date.now());
  wakeTimer = setTimeout(() => {
    wakeTimer = null;
    void flushSOSQueue();
  }, delay);
}

export async function flushSOSQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = (await getItem<QueuedSOS[]>(storageKeys.sosQueue)) ?? [];
    if (q.length === 0) return;
    const keep: QueuedSOS[] = [];
    const now = Date.now();
    for (const item of q) {
      if (now - item.queuedAt > MAX_AGE_MS) continue; // too stale, drop
      // Backing off. Keep it, do not touch it, do not count an attempt.
      if (item.nextAttemptAt && now < item.nextAttemptAt) {
        keep.push(item);
        continue;
      }
      try {
        await deliver(item);
        addBreadcrumb({ category: 'sos', severity: 'info', message: 'Queued SOS delivered', data: { id: item.record.id } });
      } catch (err) {
        const attempts = (item.attempts ?? 0) + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Give up on this one so it can't block the rest of the queue.
          reportError(err, {
            category: 'sos.queue',
            message: 'Dropping queued SOS after max retries',
            data: { id: item.record.id, attempts },
          });
          continue;
        }
        keep.push({
          ...item,
          attempts,
          // `deliver` mutates this on partial success, so a retry resumes at
          // the push instead of re-running the whole delivery.
          persisted: item.persisted,
          nextAttemptAt: Date.now() + backoffFor(attempts),
        });
      }
    }
    await setItem(storageKeys.sosQueue, keep);
    // If anything is still waiting on a backoff, wake up when the soonest one
    // is due. Without this the queue only moves on the next connectivity event,
    // which on a stable-but-broken link never comes.
    scheduleNextFlush(keep);
  } finally {
    flushing = false;
  }
}

// Call once at app boot: flush any pending SOS now, and again whenever the
// connection is restored.
export function initSOSQueue(): () => void {
  void flushSOSQueue();
  const unsub = subscribeConnection((state) => {
    if (state.isConnected) void flushSOSQueue();
  });
  return () => {
    if (wakeTimer) {
      clearTimeout(wakeTimer);
      wakeTimer = null;
    }
    unsub();
  };
}
