// notify-sharing-off — tell a circle when one of them turns location sharing off.
//
// This is the honest answer to "what stops someone just switching it off".
// Nothing stops them, and nothing should: ORBII is not a device you can lock a
// person into. What we CAN guarantee is that it is never silent. The moment
// sharing stops, everyone in the circle is told, with the time and the last
// place that person was seen.
//
// That turns the off switch from a hole in the product into a signal. A parent
// or a friend gets "she turned sharing off at 9:42 PM near Connaught Place",
// which is information they can act on, instead of a dot that quietly stopped
// updating and left them guessing for an hour.
//
// It also keeps the app honest in the other direction: the person turning it
// off is told, in the app, that their circle will be notified. No secret
// reporting, no silent tattling.
//
// Deploy:  supabase functions deploy notify-sharing-off

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** '9:42 PM' in IST, since that is where every user is. */
function istTime(d: Date): string {
  return d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

Deno.serve(async (req) => {
  try {
    const auth = req.headers.get('Authorization') ?? '';
    const { lat, lng, place } = await req.json().catch(() => ({}));

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Resolved from their own JWT, so nobody can raise this event "as" someone
    // else and fake a scare.
    const { data: userData } = await admin.auth.getUser(auth.replace('Bearer ', ''));
    const sharer = userData.user?.id;
    if (!sharer) return json({ error: 'unauthorized' }, 401);

    const { data: me } = await admin
      .from('users_public')
      .select('name')
      .eq('id', sharer)
      .maybeSingle();
    const name = me?.name ?? 'Someone in your circle';

    // Everyone who shares a circle with them.
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

    // The two facts that make this actionable: when, and where they were last.
    const when = istTime(new Date());
    const where = typeof place === 'string' && place.trim()
      ? ` Last seen near ${place.trim()}.`
      : lat != null && lng != null
        ? ' Their last known spot is on the map.'
        : '';

    const messages = tokens.map((to: string) => ({
      to,
      title: `${name} turned location sharing off`,
      body: `Switched off at ${when}.${where}`,
      sound: 'default',
      priority: 'high',
      channelId: 'safe-zone',
      data: { kind: 'sharing_off', userId: sharer, lat, lng, at: new Date().toISOString() },
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
