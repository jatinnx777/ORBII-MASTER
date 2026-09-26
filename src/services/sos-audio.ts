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

/** `<uid>/<sosId>.m4a`, the path layout the bucket's RLS policy expects. */
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
 * Never throws, the caller is on the SOS path.
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
 * Upload the pre-roll clip, the 15 seconds the mic captured BEFORE the voice
 * trigger fired. This is often the only recording of the threat itself, since
 * the SOS clip only starts once she's already shouting.
 *
 * Stored beside the main clip as `<uid>/<sosId>-preroll.wav`.
 */
export async function uploadPreRoll(
  userId: string,
  sosId: string,
  localUri: string,
): Promise<boolean> {
  try {
    const path = localUri.startsWith('file://') ? localUri : `file://${localUri}`;
    const file = new File(path);
    if (!file.exists) return false;
    const bytes = await file.bytes();
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(`${userId}/${sosId}-preroll.wav`, bytes, {
        contentType: 'audio/wav',
        upsert: true,
      });
    if (error) {
      addBreadcrumb({
        category: 'sos.recording',
        severity: 'warn',
        message: `pre-roll upload failed: ${error.message}`,
      });
      return false;
    }
    addBreadcrumb({
      category: 'sos.recording',
      severity: 'info',
      message: `pre-roll uploaded for SOS ${sosId}`,
    });
    return true;
  } catch (err) {
    reportError(err, {
      category: 'sos.recording',
      message: 'pre-roll upload threw',
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
    if (!exists) continue; // local copy gone, nothing left to upload
    const ok = await uploadSosRecording(item.userId, item.sosId, item.localUri);
    if (!ok) stillPending.push(item);
  }
  await writePending(stillPending);
}

/**
 * Delete an SOS recording from the server, at the owner's request.
 *
 * WHY THIS EXISTS. The clip is uploaded automatically on every real SOS, and
 * until now nothing could remove it: no expiry, no account deletion (that
 * deletes the row, not the file), and no control anywhere in the app. That is a
 * DPDP erasure right on the most sensitive thing ORBII holds, and the privacy
 * policy now promises it, so it has to work.
 *
 * TWO FILES, NOT ONE. Every SOS can leave `<uid>/<sosId>.m4a` and
 * `<uid>/<sosId>-preroll.wav`, and the pre-roll is often the more sensitive of
 * the two because it caught the moments before she started shouting. Deleting
 * only the clip would leave the worse recording behind while telling her it was
 * gone. Both go, always.
 *
 * ORDER: file first, pointer second. A pointer cleared while the file survives
 * is the orphan case, and here the orphan is audio of a person. If the remove
 * fails we clear nothing and report false, so the UI can say it did not work
 * instead of showing a recording as deleted while it sits in the bucket.
 *
 * The local copy on the phone is deliberately untouched. It is hers, on her own
 * device, and this function is about what WE hold.
 */
export async function deleteSosRecording(
  userId: string,
  sosId: string,
): Promise<boolean> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([storagePath(userId, sosId), `${userId}/${sosId}-preroll.wav`]);
    // remove() does not fail on a path that is not there, so a genuine error
    // here means permission or network, and neither is safe to treat as done.
    if (error) {
      addBreadcrumb({
        category: 'sos.recording',
        severity: 'warn',
        message: `audio delete failed: ${error.message}`,
      });
      return false;
    }

    const { error: rpcErr } = await supabase.rpc('forget_sos_audio', { p_sos: sosId });
    if (rpcErr) {
      // The files ARE gone, which is the part that matters for her privacy. A
      // stale pointer is a cosmetic bug that the nightly purge also clears, so
      // this reports success rather than telling her the deletion failed.
      addBreadcrumb({
        category: 'sos.recording',
        severity: 'warn',
        message: `audio deleted but pointer not cleared: ${rpcErr.message}`,
      });
    }
    return true;
  } catch (err) {
    reportError(err, {
      category: 'sos.recording',
      message: 'audio delete threw',
      tags: { sosId },
    });
    return false;
  }
}
