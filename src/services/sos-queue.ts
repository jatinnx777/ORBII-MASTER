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
};

// Drop anything older than this: a 45-minute-late "emergency" push is noise,
// not help, and could alarm the circle long after the moment has passed.
const MAX_AGE_MS = 45 * 60 * 1000;
// Retry cap: a permanently-failing item (bad payload, server rejects it) must
// not loop forever. After this many tries we drop it and report, so it can
// never block the queue behind it.
const MAX_ATTEMPTS = 8;

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

async function deliver(item: QueuedSOS): Promise<boolean> {
  const { record, user } = item;
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
      circle_only: !user.isPremium,
    },
    { onConflict: 'id' },
  );
  if (error) throw error;
  await supabase.functions.invoke('notify-sos', { body: { sosId: record.id } });
  return true;
}

let flushing = false;
export async function flushSOSQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const q = (await getItem<QueuedSOS[]>(storageKeys.sosQueue)) ?? [];
    if (q.length === 0) return;
    const keep: QueuedSOS[] = [];
    for (const item of q) {
      if (Date.now() - item.queuedAt > MAX_AGE_MS) continue; // too stale, drop
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
        keep.push({ ...item, attempts }); // still offline / failed — retry next time
      }
    }
    await setItem(storageKeys.sosQueue, keep);
  } finally {
    flushing = false;
  }
}

// Call once at app boot: flush any pending SOS now, and again whenever the
// connection is restored.
export function initSOSQueue(): () => void {
  void flushSOSQueue();
  return subscribeConnection((state) => {
    if (state.isConnected) void flushSOSQueue();
  });
}
