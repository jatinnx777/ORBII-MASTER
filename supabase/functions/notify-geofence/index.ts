// notify-geofence — push the people who set a safe zone when it's crossed.
//
// The fenced person's device calls this (fire-and-forget) right after it stores
// a geofence_events row. Running with the service-role key, it finds everyone
// who set that zone and pushes them.
//
// Deploy:  supabase functions deploy notify-geofence

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  try {
    const { geofenceId, kind } = await req.json().catch(() => ({}));
    if (!geofenceId) return json({ error: 'missing geofenceId' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: zone } = await admin
      .from('geofences')
      .select('id, owner_id, member_id, label')
      .eq('id', geofenceId)
      .single();
    if (!zone) return json({ error: 'zone not found' }, 404);

    // Never push someone about their own zone on themselves.
    if (zone.owner_id === zone.member_id) return json({ sent: 0, reason: 'self zone' });

    const { data: who } = await admin
      .from('users_public')
      .select('name')
      .eq('id', zone.member_id)
      .maybeSingle();
    const name = who?.name ?? 'Someone in your circle';

    const { data: toks } = await admin
      .from('push_tokens')
      .select('token')
      .eq('user_id', zone.owner_id);
    const tokens = (toks ?? [])
      .map((t: { token: string }) => t.token)
      .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
    if (tokens.length === 0) return json({ sent: 0, reason: 'no tokens' });

    const left = kind === 'exit';
    const messages = tokens.map((to: string) => ({
      to,
      title: left ? `${name} left ${zone.label}` : `${name} arrived at ${zone.label}`,
      body: left
        ? 'Tap to check on them.'
        : 'They just entered this safe zone.',
      sound: 'default',
      priority: 'high',
      channelId: 'safe-zone',
      data: { kind: 'geofence', geofenceId, event: kind },
    }));

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
    return json({ sent });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
