// escalate-sos — never let an emergency stall silently.
//
// Runs on a schedule. Asks the database which active SOS events need action,
// then does the two things a database should not: sends pushes, and dispatches
// the next wave of helpers.
//
// The rule it enforces: an SOS that people have ARRIVED at but nobody has
// resolved is the most dangerous state in the system, because it looks handled.
// Helpers were sent, helpers got there, the dashboard is green, and she is
// still in trouble. So arrival is not the end of the process; being safe is.
//
// Silence from the victim always escalates. A woman who cannot answer her phone
// is precisely the person who needs the next three people, and reading
// no-answer as "probably fine" gets that exactly backwards.
//
// Deploy:  supabase functions deploy escalate-sos --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type Admin = ReturnType<typeof createClient>;

async function push(messages: Record<string, unknown>[]): Promise<number> {
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const r = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (r.ok) sent += chunk.length;
  }
  return sent;
}

async function tokensFor(admin: Admin, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const { data } = await admin.from('push_tokens').select('token').in('user_id', userIds);
  return (data ?? [])
    .map((t: { token: string }) => t.token)
    .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
}

Deno.serve(async () => {
  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await admin.rpc('sos_escalation_tick');
    if (error) return json({ error: error.message }, 500);

    const jobs = (data ?? []) as {
      sos_id: string;
      victim_id: string;
      lat: number;
      lng: number;
      wave: number;
      action: string;
    }[];
    if (jobs.length === 0) return json({ handled: 0 });

    let pinged = 0;
    let dispatched = 0;

    for (const j of jobs) {
      if (j.action === 'ping_victim') {
        // Straight to her, full volume. This is not a status update; it is the
        // system asking whether the people standing next to her actually helped.
        const toks = await tokensFor(admin, [j.victim_id]);
        if (toks.length > 0) {
          pinged += await push(
            toks.map((to) => ({
              to,
              title: 'Are you safe?',
              body: 'Help reached you. Tap to tell us, or we will send more people.',
              sound: 'default',
              priority: 'high',
              channelId: 'sos',
              categoryId: 'safety_check',
              data: { kind: 'safety_check', sosId: j.sos_id },
            })),
          );
        }
        continue;
      }

      if (j.action === 'dispatch_wave') {
        const { data: helpers } = await admin.rpc('next_wave_helpers', {
          p_sos: j.sos_id,
          p_lat: j.lat,
          p_lng: j.lng,
          p_limit: 3,
        });
        const ids = ((helpers ?? []) as { user_id: string }[]).map((h) => h.user_id);
        const toks = await tokensFor(admin, ids);
        if (toks.length > 0) {
          dispatched += await push(
            toks.map((to) => ({
              to,
              title: 'Someone nearby still needs help',
              body: `Wave ${j.wave}. People went and it is not resolved. Can you get there?`,
              sound: 'default',
              priority: 'high',
              channelId: 'sos',
              data: { kind: 'sos_wave', sosId: j.sos_id, wave: j.wave, lat: j.lat, lng: j.lng },
            })),
          );
        }
      }
    }

    return json({ handled: jobs.length, pinged, dispatched });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
