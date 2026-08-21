// drain-push — send whatever is sitting in push_outbox.
//
// The second half of the hybrid fan-out in notify-sos. That function sends the
// first 100 recipients inline, on the same latency as before, and drops the
// unbounded tail here. This is the part that used to time the function out and
// silently lose the people at the end of a large circle.
//
// Two callers, deliberately:
//   1. notify-sos invokes it immediately after enqueueing, so in the normal
//      case the tail goes out within a second of the head.
//   2. pg_cron, or an external ping, as the safety net for when that invoke
//      fails or the function cold-starts badly.
//
// Safe to run concurrently with itself. push_claim uses FOR UPDATE SKIP LOCKED,
// so two drains take disjoint batches and neither blocks the other.
//
// Deploy:  supabase functions deploy drain-push --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { report } from '../_shared/report.ts';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK = 100;
// One invocation's ceiling. Past this we return and let the next call continue,
// rather than risk the wall-clock limit mid-chunk.
const MAX_PER_RUN = 500;

type Claimed = { id: number; token: string; payload: Record<string, unknown> };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body?.limit ?? MAX_PER_RUN), MAX_PER_RUN);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let sent = 0;
    let failed = 0;
    let drained = 0;

    while (drained < limit) {
      const want = Math.min(EXPO_CHUNK, limit - drained);
      const { data, error } = await admin.rpc('push_claim', { p_limit: want });
      if (error) {
        // The drain cannot claim work. This is the silent-failure case: no
        // pushes go out and nothing else in the system notices.
        await report(admin, 'drain-push', `push_claim failed: ${error.message}`,
          { drained, sent, failed }, 'fatal');
        return json({ error: error.message }, 500);
      }

      const rows = (data ?? []) as Claimed[];
      if (rows.length === 0) break; // queue empty
      drained += rows.length;

      // push_claim already stamped these with a one minute send_after, so if
      // this function dies right here the rows return to the queue on their own
      // rather than being lost or double-sent immediately.
      const messages = rows.map((r) => ({ ...r.payload, to: r.token }));

      try {
        const res = await fetch(EXPO_PUSH, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(messages),
        });

        if (!res.ok) {
          await admin.rpc('push_mark_failed', {
            p_ids: rows.map((r) => r.id),
            p_error: `expo ${res.status}`,
          });
          failed += rows.length;
          // A 401 or 403 here means credentials stopped being accepted, which
          // silently kills every push in the product. Report the whole class,
          // not just the batch: counts only, never a token.
          await report(admin, 'drain-push',
            `Expo rejected a batch with HTTP ${res.status}`,
            { status: res.status, batch: rows.length },
            res.status === 401 || res.status === 403 ? 'fatal' : 'error');
          continue;
        }

        // Expo returns a per-message ticket array in the same order. A 200 on
        // the request does NOT mean every message was accepted, so mark them
        // individually: a dead device token must not be retried five times.
        const out = await res.json().catch(() => null);
        const tickets: { status?: string; message?: string }[] =
          out?.data ?? [];

        const ok: number[] = [];
        const bad: number[] = [];
        rows.forEach((r, i) => {
          const t = tickets[i];
          if (!t || t.status === 'ok') ok.push(r.id);
          else bad.push(r.id);
        });

        if (ok.length) await admin.rpc('push_mark_sent', { p_ids: ok });
        if (bad.length) {
          await admin.rpc('push_mark_failed', {
            p_ids: bad,
            p_error: tickets.find((t) => t?.status !== 'ok')?.message ?? 'expo rejected',
          });
        }
        sent += ok.length;
        failed += bad.length;
      } catch (err) {
        await admin.rpc('push_mark_failed', {
          p_ids: rows.map((r) => r.id),
          p_error: err instanceof Error ? err.message : String(err),
        });
        failed += rows.length;
      }
    }

    return json({ ok: true, drained, sent, failed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const admin = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      );
      await report(admin, 'drain-push', `unhandled: ${msg}`, undefined, 'fatal');
    } catch {
      // nothing left to try
    }
    return json({ error: msg }, 500);
  }
});
