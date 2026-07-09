import { File } from 'expo-file-system';
import { supabase } from './supabase';
import { getItem, setItem } from './storage';
import { addBreadcrumb, reportError } from './error-reporting';

// SOS audio evidence. The clip is always written to the device first (that
// happens in sos-recording.ts and must never be blocked). This module gets it
// OFF the device and into the private `sos-recordings` bucket, because a
// recording that only exists on a phone that was snatched or smashed is not
// evidence.
//
// Network during an emergency is exactly when you cannot trust it, so a failed
// upload is queued and retried on the next app start. The local file is kept
// either way.
//
// Requires sql/11_sos_audio.sql (bucket + `sos_events.audio_path` + RLS).

const BUCKET = 'sos-recordings';
const PENDING_KEY = 'orbii:sos-audio-pending';

type Pending = { userId: string; sosId: string; localUri: string; at: number };

/** `<uid>/<sosId>.m4a` — the path layout the bucket's RLS policy expects. */
function storagePath(userId: string, sosId: string): string {
  return `${userId}/${sosId}.m4a`;
}

async function readPending(): Promise<Pending[]> {
  return (await getItem<Pending[]>(PENDING_KEY)) ?? [];
}

async function writePending(items: Pending[]): Promise<void> {
  await setItem(PENDING_KEY, items.slice(-20)); // never grow without bound
}

async function enqueue(item: Pending): Promise<void> {
  const items = await readPending();
  if (items.some((i) => i.sosId === item.sosId)) return;
  await writePending([...items, item]);
}

/**
 * Upload one clip and stamp `sos_events.audio_path`. Returns true on success.
 * Never throws — the caller is on the SOS path.
 */
export async function uploadSosRecording(
  userId: string,
  sosId: string,
  localUri: string,
): Promise<boolean> {
  try {
    const file = new File(localUri);
    if (!file.exists) return false;
    const bytes = await file.bytes();
    const path = storagePath(userId, sosId);

    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: 'audio/m4a',
      upsert: true,
    });
    if (error) {
      await enqueue({ userId, sosId, localUri, at: Date.now() });
      addBreadcrumb({
        category: 'sos.recording',
        severity: 'warn',
        message: `audio upload failed, queued for retry: ${error.message}`,
      });
      return false;
    }

    // Point the incident at its evidence. Owner-only update per RLS.
    await supabase.from('sos_events').update({ audio_path: path }).eq('id', sosId);
    addBreadcrumb({
      category: 'sos.recording',
      severity: 'info',
      message: `audio uploaded for SOS ${sosId}`,
    });
    return true;
  } catch (err) {
    await enqueue({ userId, sosId, localUri, at: Date.now() }).catch(() => undefined);
    reportError(err, {
      category: 'sos.recording',
      message: 'audio upload threw',
      tags: { sosId },
    });
    return false;
  }
}

/**
 * Retry anything that failed while the phone was offline. Safe to call on every
 * app start; drops entries whose local file is gone.
 */
export async function flushPendingSosAudio(): Promise<void> {
  const items = await readPending();
  if (items.length === 0) return;
  const stillPending: Pending[] = [];
  for (const item of items) {
    let exists = false;
    try {
      exists = new File(item.localUri).exists;
    } catch {
      exists = false;
    }
    if (!exists) continue; // local copy gone — nothing left to upload
    const ok = await uploadSosRecording(item.userId, item.sosId, item.localUri);
    if (!ok) stillPending.push(item);
  }
  await writePending(stillPending);
}
