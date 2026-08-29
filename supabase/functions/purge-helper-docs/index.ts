// purge-helper-docs — delete identity document images once they have served
// their only purpose, which is being looked at once by a person.
//
// WHY THIS IS A FUNCTION AND NOT SQL.
// The first attempt did this in Postgres, deleting straight from
// storage.objects. Supabase refuses:
//
//   ERROR 42501: Direct deletion from storage tables is not allowed.
//   Use the Storage API instead.
//
// And it is right to refuse. A storage object is a database row AND a file in
// object storage; deleting the row alone orphans the file, which for this
// feature would be the worst possible outcome: the record would say the Aadhaar
// was purged while the image sat there forever. So the deletion has to go
// through the Storage API, which means it has to be here.
//
// WHAT IT DELETES.
//   • Documents a reviewer has decided on. The verdict is kept, the image goes.
//   • Anything older than `days` regardless, so an application nobody got to
//     does not quietly become a permanent archive of somebody's Aadhaar.
//
// The row keeps status, verified_name and id_last4. Only storage_path is
// cleared, and only after the file is actually gone.
//
// Deploy:  supabase functions deploy purge-helper-docs

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'helper-docs';
const DEFAULT_DAYS = 7;
// Storage remove() takes a list. Kept modest so one bad batch cannot stall the
// whole run, and so a partial failure retries on the next pass rather than
// leaving a large set half-done.
const BATCH = 50;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Number.isFinite(body?.days) ? Math.max(0, Number(body.days)) : DEFAULT_DAYS;

    const sb = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    // Decided documents at any age, plus anything past the cutoff. A decided
    // document has no further use for its image: the verdict is already stored.
    const { data: rows, error } = await sb
      .from('helper_documents')
      .select('user_id, doc_key, storage_path, status, uploaded_at')
      .not('storage_path', 'is', null)
      .or(`status.in.(approved,rejected),uploaded_at.lt.${cutoff}`)
      .limit(500);

    if (error) return json({ error: error.message }, 500);
    if (!rows || rows.length === 0) return json({ purged: 0, message: 'nothing to purge' });

    let purged = 0;
    const failures: string[] = [];

    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const paths = slice.map((r) => r.storage_path as string);

      const { error: rmErr } = await sb.storage.from(BUCKET).remove(paths);
      if (rmErr) {
        // Do NOT clear storage_path when the file is still there. A row that
        // claims to be purged while the image survives is worse than a retry.
        failures.push(rmErr.message);
        continue;
      }

      for (const r of slice) {
        const { error: upErr } = await sb
          .from('helper_documents')
          .update({ storage_path: null, purged_at: new Date().toISOString() })
          .eq('user_id', r.user_id)
          .eq('doc_key', r.doc_key);
        if (upErr) failures.push(upErr.message);
        else purged += 1;
      }
    }

    return json({ purged, failures: failures.slice(0, 5), considered: rows.length });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
