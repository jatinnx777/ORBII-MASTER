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

// Staged helper dispatch. Start tight (2 km): the nearest helper reaches her
// fastest and we don't wake half the city for every SOS. If nobody has accepted
// after ESCALATE_MS, widen to 5 km. Escalation stops the moment a helper accepts
// (a rescue_events row appears) or the SOS is resolved/cancelled.
const STAGE1_KM = 2;
const STAGE2_KM = 5;
const ESCALATE_MS = 40_000;

// deno-lint-ignore no-explicit-any
type Admin = any;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Send Expo push messages, chunked at Expo's 100-per-request limit.
async function sendExpo(messages: Record<string, unknown>[]): Promise<number> {
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

// Push nearby ONLINE VERIFIED helpers within `radiusKm`, skipping anyone in
// `exclude` (the victim's circle, and — on the second stage — the helpers we
// already alerted). Returns the ids we pushed so the next stage can skip them.
async function pushVerifiedHelpers(
  admin: Admin,
  sos: { id: string; user_id: string; lat: number; lng: number; user_name?: string },
  radiusKm: number,
  exclude: Set<string>,
): Promise<string[]> {
  const { data: helpers } = await admin.rpc('dispatch_verified_helpers', {
    p_lat: sos.lat,
    p_lng: sos.lng,
    p_radius_km: radiusKm,
    p_exclude: sos.user_id,
  });
  const ids: string[] = (helpers ?? [])
    .map((h: { user_id: string }) => h.user_id)
    .filter((id: string) => !exclude.has(id));
  if (ids.length === 0) return [];

  const { data: htoks } = await admin
    .from('push_tokens')
    .select('token')
    .in('user_id', ids);
  const tokens: string[] = (htoks ?? [])
    .map((t: { token: string }) => t.token)
    .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));

  const name = sos.user_name ?? 'Someone';
  await sendExpo(
    tokens.map((to) => ({
      to,
      title: '🆘 Someone needs help now',
      body: `${name} is in danger nearby. Tap to respond.`,
      sound: 'default',
      priority: 'high',
      channelId: 'incoming_sos',
      data: { kind: 'incoming_sos', sosId: sos.id, lat: sos.lat, lng: sos.lng, name },
    })),
  );
  return ids;
}

// Has any helper accepted this SOS yet? Acceptance opens a rescue_events row.
async function anyoneResponded(admin: Admin, sosId: string): Promise<boolean> {
  const { count } = await admin
    .from('rescue_events')
    .select('id', { count: 'exact', head: true })
    .eq('sos_id', sosId);
  return (count ?? 0) > 0;
}

// Still worth escalating? Only if the SOS is live (not cancelled/resolved).
async function sosStillActive(admin: Admin, sosId: string): Promise<boolean> {
  const { data } = await admin
    .from('sos_events')
    .select('status')
    .eq('id', sosId)
    .single();
  return data?.status === 'active';
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
      .select('id, user_id, user_name, lat, lng, circle_only')
      .eq('id', sosId)
      .single();
    if (!sos) return json({ error: 'sos not found' }, 404);

    const victim: string = sos.user_id;
    const recipients = new Set<string>();

    // Verified-helper dispatch is the PAID tier's advantage. We check the
    // victim's entitlement SERVER-SIDE (never a client flag) — active + premium.
    // Free users still reach nearby community members via the realtime broadcast
    // and the nearby-SOS query; they just don't summon the vetted helper pool.
    let victimIsPremium = false;
    {
      const { data: ent } = await admin
        .from('entitlements')
        .select('premium_enabled, status')
        .eq('user_id', victim)
        .maybeSingle();
      victimIsPremium = ent?.premium_enabled === true && ent?.status === 'active';
    }

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

    // 4. Circle + contacts get the standard SOS push, right away and always.
    let circleSent = 0;
    if (recipients.size > 0) {
      const { data: toks } = await admin
        .from('push_tokens')
        .select('token')
        .in('user_id', [...recipients]);
      const tokens = (toks ?? [])
        .map((t: { token: string }) => t.token)
        .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
      circleSent = await sendExpo(
        tokens.map((to: string) => ({
          to,
          title: `🆘 ${name} needs help`,
          body: 'Tap to see their live location and respond.',
          sound: 'default',
          priority: 'high',
          channelId: 'sos',
          data: { kind: 'sos_push', sosId, lat: sos.lat, lng: sos.lng },
        })),
      );
    }

    // 5. VERIFIED HELPERS — only for a PREMIUM victim with a known location.
    // Staged: 2 km now, widen to 5 km after 40 s only if nobody has accepted and
    // the SOS is still live. Circle members are excluded so nobody is
    // double-pushed, and stage 2 skips whoever stage 1 already got.
    let stage1Helpers = 0;
    const canDispatchHelpers =
      victimIsPremium && sos.lat != null && sos.lng != null;
    if (canDispatchHelpers) {
      const sosLite = {
        id: sos.id,
        user_id: victim,
        lat: sos.lat as number,
        lng: sos.lng as number,
        user_name: sos.user_name,
      };
      const stage1Ids = await pushVerifiedHelpers(
        admin,
        sosLite,
        STAGE1_KM,
        new Set(recipients),
      );
      stage1Helpers = stage1Ids.length;

      // Stage 2 runs AFTER we return, kept alive by EdgeRuntime.waitUntil so the
      // 40 s wait survives the response being sent back to the fire-and-forget
      // caller. It self-cancels if a helper accepted or the SOS ended.
      const escalate = (async () => {
        await new Promise((r) => setTimeout(r, ESCALATE_MS));
        if (!(await sosStillActive(admin, sosId))) return;
        if (await anyoneResponded(admin, sosId)) return;
        const exclude = new Set<string>([...recipients, ...stage1Ids]);
        await pushVerifiedHelpers(admin, sosLite, STAGE2_KM, exclude);
      })().catch(() => {
        /* background best-effort — never throws into the response */
      });
      try {
        // deno-lint-ignore no-explicit-any
        (globalThis as any).EdgeRuntime?.waitUntil?.(escalate);
      } catch {
        // Runtime without waitUntil: fall through; stage 1 still went out.
      }
    }

    // 6. COMMUNITY RESPONDERS — for a FREE victim. Nearby NON-verified helpers
    // (ordinary users who turned on helper mode) get the alert too, so a free
    // user can still be reached by whoever is close. They may or may not come;
    // that's the free tier. A single 5 km push, no staged escalation — the
    // reliable, escalating pool is the paid perk above.
    let communitySent = 0;
    if (!victimIsPremium && sos.lat != null && sos.lng != null) {
      const { data: comm } = await admin.rpc('dispatch_community_helpers', {
        p_lat: sos.lat,
        p_lng: sos.lng,
        p_radius_km: STAGE2_KM,
        p_exclude: victim,
      });
      const ids: string[] = (comm ?? [])
        .map((h: { user_id: string }) => h.user_id)
        .filter((id: string) => !recipients.has(id));
      if (ids.length > 0) {
        const { data: ctoks } = await admin
          .from('push_tokens')
          .select('token')
          .in('user_id', ids);
        const tokens: string[] = (ctoks ?? [])
          .map((t: { token: string }) => t.token)
          .filter((t: string) => !!t && t.startsWith('ExponentPushToken'));
        communitySent = await sendExpo(
          tokens.map((to) => ({
            to,
            title: '🆘 Someone nearby needs help',
            body: `${name} is in danger near you. Tap if you can help.`,
            sound: 'default',
            priority: 'high',
            channelId: 'incoming_sos',
            data: { kind: 'incoming_sos', sosId: sos.id, lat: sos.lat, lng: sos.lng, name },
          })),
        );
      }
    }

    return json({
      sent: circleSent + stage1Helpers + communitySent,
      circle: circleSent,
      stage1Helpers,
      communitySent,
      escalating: canDispatchHelpers,
    });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
