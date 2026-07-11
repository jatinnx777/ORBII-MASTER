// notify-sos — server-side push fan-out for an SOS.
//
// The app calls this (fire-and-forget) right after creating an sos_events row.
// Running with the service-role key, it figures out WHO should be alerted
// (the victim's circle members + emergency contacts who use ORBII), looks up
// their device push tokens, and sends a high-priority push via Expo's push
// service — so people are reached even when their app is closed.
//
// Deploy:  supabase functions deploy notify-sos
// Secrets: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// No paid services: Expo's push endpoint is free; it requires FCM to be
// configured for the project (see PUSH_SETUP.md).

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
    const { sosId } = await req.json().catch(() => ({}));
    if (!sosId) return json({ error: 'missing sosId' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // 1. The SOS row. `circle_only` is the premium flag (true = free user, who
    // must never reach strangers; false = premium, whose SOS may reach the
    // verified-helper pool).
    const { data: sos } = await admin
      .from('sos_events')
      .select('id, user_id, user_name, lat, lng, circle_only')
      .eq('id', sosId)
      .single();
    if (!sos) return json({ error: 'sos not found' }, 404);

    const victim: string = sos.user_id;
    const recipients = new Set<string>();

    // 2. Everyone in the victim's circles.
    const { data: myCircles } = await admin
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', victim);
    const circleIds = (myCircles ?? []).map((c: { circle_id: string }) => c.circle_id);
    if (circleIds.length > 0) {
      const { data: members } = await admin
        .from('circle_members')
        .select('user_id')
        .in('circle_id', circleIds);
      (members ?? []).forEach((m: { user_id: string }) => {
        if (m.user_id !== victim) recipients.add(m.user_id);
      });
    }

    // 3. Emergency contacts who are themselves ORBII users (matched by phone).
    const { data: contacts } = await admin
      .from('emergency_contacts')
      .select('phone')
      .eq('user_id', victim);
    for (const c of contacts ?? []) {
      const { data: u } = await admin
        .from('users_public')
        .select('id')
        .eq('phone', c.phone)
        .maybeSingle();
      if (u?.id && u.id !== victim) recipients.add(u.id);
    }

    const name = sos.user_name ?? 'Someone';
    const messages: Record<string, unknown>[] = [];

    // 4. Circle + contacts get the standard SOS push.
    if (recipients.size > 0) {
      const { data: toks } = await admin
        .from('push_tokens')
        .select('token')
        .in('user_id', [...recipients]);
      const tokens = (toks ?? [])
        .map((t: { token: string }) => t.token)
        .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
      for (const to of tokens) {
        messages.push({
          to,
          title: `🆘 ${name} needs help`,
          body: 'Tap to see their live location and respond.',
          sound: 'default',
          priority: 'high',
          channelId: 'sos',
          data: { kind: 'sos_push', sosId, lat: sos.lat, lng: sos.lng },
        });
      }
    }

    // 5. VERIFIED HELPERS — only for a PREMIUM victim (circle_only === false),
    // and only those online + nearby. They get a distinct, louder channel so a
    // stranger-help request reads differently from a family alert, and it reaches
    // them even when the app has been closed all day. Circle members already
    // covered above are excluded so nobody is double-pushed.
    if (sos.circle_only === false && sos.lat != null && sos.lng != null) {
      const { data: helpers } = await admin.rpc('dispatch_verified_helpers', {
        p_lat: sos.lat,
        p_lng: sos.lng,
        p_radius_km: 7,
        p_exclude: victim,
      });
      const helperIds = (helpers ?? [])
        .map((h: { user_id: string }) => h.user_id)
        .filter((id: string) => !recipients.has(id));
      if (helperIds.length > 0) {
        const { data: htoks } = await admin
          .from('push_tokens')
          .select('token')
          .in('user_id', helperIds);
        const helperTokens = (htoks ?? [])
          .map((t: { token: string }) => t.token)
          .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
        for (const to of helperTokens) {
          messages.push({
            to,
            title: '🆘 Someone needs help now',
            body: `${name} is in danger nearby. Tap to respond.`,
            sound: 'default',
            priority: 'high',
            channelId: 'incoming_sos',
            data: { kind: 'incoming_sos', sosId, lat: sos.lat, lng: sos.lng, name },
          });
        }
      }
    }

    if (messages.length === 0) return json({ sent: 0, reason: 'no recipients' });

    // 6. Send (chunked at 100, Expo's limit).
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
