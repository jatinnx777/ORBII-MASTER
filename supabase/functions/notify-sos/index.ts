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

    // 1. The SOS row.
    const { data: sos } = await admin
      .from('sos_events')
      .select('id, user_id, user_name, lat, lng')
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

    if (recipients.size === 0) return json({ sent: 0, reason: 'no recipients' });

    // 4. Their push tokens.
    const { data: toks } = await admin
      .from('push_tokens')
      .select('token')
      .in('user_id', [...recipients]);
    const tokens = (toks ?? [])
      .map((t: { token: string }) => t.token)
      .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
    if (tokens.length === 0) return json({ sent: 0, reason: 'no tokens' });

    // 5. Send (chunked at 100, Expo's limit).
    const name = sos.user_name ?? 'Someone';
    const messages = tokens.map((to: string) => ({
      to,
      title: `🆘 ${name} needs help`,
      body: 'Tap to see their live location and respond.',
      sound: 'default',
      priority: 'high',
      channelId: 'sos',
      data: { kind: 'sos_push', sosId, lat: sos.lat, lng: sos.lng },
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
