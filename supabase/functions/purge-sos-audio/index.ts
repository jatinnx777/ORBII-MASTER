// purge-sos-audio — SOS recordings stop being kept forever.
//
// WHY THIS EXISTS.
// Every real SOS records a short clip and uploads it to the private
// `sos-recordings` bucket (src/services/sos-audio.ts). Nothing ever deleted it.
// Not an expiry, not account deletion, not the three-year incident purge in
// sql/146 — because deleting a database row does not touch object storage.
//
// So the most sensitive thing this product holds, a recording of somebody's
// worst night, was the one thing with no retention period at all. The privacy
// policy also said SOS audio never left the device, which was simply wrong. Both
// halves are fixed: the policy now describes the upload, and this deletes it at
// 90 days.
//
// WHY IT LISTS STORAGE RATHER THAN READING sos_events.audio_path.
// The path column is the obvious index, and it is the wrong one. Deleting an
// account deletes the sos_events row, and the three-year purge deletes it too,
// so a clip whose row is gone would become invisible to any query-driven purge
// and survive forever. Exactly the orphaned-file failure sql/148 fixes for
// helper documents, and worse here because the file is audio of a person.
//
// Listing the bucket finds every object, orphan or not, and object storage keeps
// its own created_at, so age needs no help from a row that may not exist.
//
// WHY 90 DAYS. Long enough to be evidence in a police complaint filed weeks
// later, which is the reason the clip is uploaded at all. Short enough that an
// archive does not accumulate. The person can delete theirs sooner from History,
// and nothing here waits on them doing so.
//
// Deploy:  supabase functions deploy purge-sos-audio

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'sos-recordings';
const DEFAULT_DAYS = 90;
// Same reasoning as purge-helper-docs: modest batches so one bad remove cannot
// stall the run, and a partial failure retries tomorrow rather than leaving a
// large set half-done.
const BATCH = 50;
// Objects are laid out `<uid>/<sosId>.m4a`, so the listing is per-user folder.
// Caps exist so one run cannot be unbounded; whatever is missed is picked up on
// the next pass, and nothing is deleted early by being missed.
const MAX_FOLDERS = 500;
const MAX_PER_FOLDER = 200;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Number.isFinite(body?.days)
      ? Math.max(1, Number(body.days))
      : DEFAULT_DAYS;
    // A dry run reports what it WOULD delete and deletes nothing. The first
    // time this is pointed at a bucket of real recordings, that is the only
    // responsible way to check the age arithmetic.
    const dryRun = body?.dryRun === true;

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const cutoffMs = Date.now() - days * 86_400_000;

    // Top level of the bucket is one folder per user id.
    const { data: folders, error: fErr } = await sb.storage
      .from(BUCKET)
      .list('', { limit: MAX_FOLDERS });
    if (fErr) return json({ error: fErr.message }, 500);
    if (!folders || folders.length === 0) {
      return json({ purged: 0, message: 'bucket is empty' });
    }

    const expired: string[] = [];

    for (const folder of folders) {
      // A listing entry with no id is a prefix (a folder); anything else at the
      // top level is unexpected and is left alone rather than guessed at.
      if (folder.id !== null && folder.id !== undefined) continue;

      const { data: objects, error: oErr } = await sb.storage
        .from(BUCKET)
        .list(folder.name, { limit: MAX_PER_FOLDER });
      if (oErr || !objects) continue;

      for (const o of objects) {
        // created_at missing means the age cannot be established, so the file is
        // KEPT. Deleting a recording on a guess is not recoverable; keeping one
        // an extra day is.
        const created = o.created_at ? Date.parse(o.created_at) : NaN;
        if (!Number.isFinite(created)) continue;
        if (created < cutoffMs) expired.push(`${folder.name}/${o.name}`);
      }
    }

    if (expired.length === 0) {
      return json({ purged: 0, message: 'nothing past the cutoff', days });
    }
    if (dryRun) {
      return json({
        dryRun: true,
        days,
        wouldPurge: expired.length,
        sample: expired.slice(0, 5),
      });
    }

    let purged = 0;
    const failures: string[] = [];

    for (let i = 0; i < expired.length; i += BATCH) {
      const slice = expired.slice(i, i + BATCH);
      const { error: rmErr } = await sb.storage.from(BUCKET).remove(slice);
      if (rmErr) {
        failures.push(rmErr.message);
        continue;
      }
      purged += slice.length;

      // Clear the pointer only for rows that still exist, and only after the
      // file is gone. A row saying the audio is there when it is not sends
      // somebody looking for evidence that has been deleted.
      for (const path of slice) {
        const sosId = path.split('/')[1]?.replace(/\.m4a$/, '');
        if (!sosId) continue;
        await sb
          .from('sos_events')
          .update({ audio_path: null })
          .eq('id', sosId)
          .then(undefined, () => undefined);
      }
    }

    return json({
      purged,
      considered: expired.length,
      days,
      failures: failures.slice(0, 5),
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
