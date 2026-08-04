// notify-geofence — when someone leaves a geofenced area, alert EVERYONE in
// their circle, with who left, which place, the time, and the location.
//
// The fenced person's device calls this (fire-and-forget) right after it stores
// the geofence_events row. Running with the service-role key, it finds every
// member of every circle the fenced person is in and pushes them all.
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
    const { geofenceId, kind, eventId } = await req.json().catch(() => ({}));
    if (!geofenceId) return json({ error: 'missing geofenceId' }, 400);
    // We only alert the circle when someone LEAVES.
    if (kind && kind !== 'exit') return json({ sent: 0, reason: 'not an exit' });

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

    // Who left.
    const { data: who } = await admin
      .from('users_public')
      .select('name')
      .eq('id', zone.member_id)
      .maybeSingle();
    const name = who?.name ?? 'Someone in your circle';

    // When + where (from the stored event, if we got its id).
    let at = Date.now();
    let lat: number | null = null;
    let lng: number | null = null;
    if (eventId) {
      const { data: ev } = await admin
        .from('geofence_events')
        .select('created_at, lat, lng')
        .eq('id', eventId)
        .maybeSingle();
      if (ev) {
        at = ev.created_at ? Date.parse(ev.created_at) : at;
        lat = ev.lat ?? null;
        lng = ev.lng ?? null;
      }
    }
    const timeStr = new Date(at).toLocaleString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    });

    // Recipients: everyone in every circle the fenced person belongs to, minus
    // the fenced person themselves.
    const { data: myCircles } = await admin
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', zone.member_id);
    const circleIds = (myCircles ?? []).map((c: { circle_id: string }) => c.circle_id);
    const recipients = new Set<string>();
    if (circleIds.length > 0) {
      const { data: members } = await admin
        .from('circle_members')
        .select('user_id')
        .in('circle_id', circleIds);
      (members ?? []).forEach((m: { user_id: string }) => {
        if (m.user_id !== zone.member_id) recipients.add(m.user_id);
      });
    }
    // The zone owner is always told, even if the circle rows are out of sync.
    if (zone.owner_id !== zone.member_id) recipients.add(zone.owner_id);
    if (recipients.size === 0) return json({ sent: 0, reason: 'no recipients' });

    const { data: toks } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', [...recipients]);
    const tokens = (toks ?? [])
      .map((t: { token: string }) => t.token)
      .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
    if (tokens.length === 0) return json({ sent: 0, reason: 'no tokens' });

    const messages = tokens.map((to: string) => ({
      to,
      title: `${name} left ${zone.label}`,
      body: `Left at ${timeStr}. Tap to see where.`,
      sound: 'default',
      priority: 'high',
      channelId: 'safe-zone',
      data: { kind: 'geofence', geofenceId, event: 'exit', at, lat, lng, name, label: zone.label },
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
