// notify-location-share — ping a user's circle when they share their location.
//
// Non-emergency: this is "here's where I am", not an SOS. It goes to the
// person's own circle only, on the normal channel, never the SOS one.
//
// Deploy:  supabase functions deploy notify-location-share

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
    const auth = req.headers.get('Authorization') ?? '';
    const { lat, lng, link } = await req.json().catch(() => ({}));

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Who is sharing — resolved from their own JWT, so nobody can share "as"
    // someone else.
    const { data: userData } = await admin.auth.getUser(auth.replace('Bearer ', ''));
    const sharer = userData.user?.id;
    if (!sharer) return json({ error: 'unauthorized' }, 401);

    const { data: me } = await admin
      .from('users_public')
      .select('name')
      .eq('id', sharer)
      .maybeSingle();
    const name = me?.name ?? 'Someone in your circle';

    // Everyone in the sharer's circles.
    const { data: myCircles } = await admin
      .from('circle_members')
      .select('circle_id')
      .eq('user_id', sharer);
    const circleIds = (myCircles ?? []).map((c: { circle_id: string }) => c.circle_id);
    const recipients = new Set<string>();
    if (circleIds.length > 0) {
      const { data: members } = await admin
        .from('circle_members')
        .select('user_id')
        .in('circle_id', circleIds);
      (members ?? []).forEach((m: { user_id: string }) => {
        if (m.user_id !== sharer) recipients.add(m.user_id);
      });
    }
    if (recipients.size === 0) return json({ sent: 0, reason: 'no circle' });

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
      title: `${name} shared their location`,
      body: 'Tap to see where they are.',
      sound: 'default',
      priority: 'high',
      channelId: 'safe-zone',
      data: { kind: 'location_share', lat, lng, link },
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
