// mesh-bridge — turns an offline mesh SOS hop into a real alert.
//
// Phase 1 of the offline mesh. When a victim has no internet, their sealed SOS
// packet hops phone-to-phone over Bluetooth (see OrbiiMeshService.kt). The FIRST
// relay that DOES have internet POSTs the opaque sealed blob here. Running with
// the service-role key, this function:
//   1. unseals the blob with the server's private key (relays never can),
//   2. dedups on the mesh message id (many relays may bridge the same SOS),
//   3. creates the sos_events row and fans out via notify-sos,
// so the victim's circle is alerted exactly as if they had signal.
//
// Deploy:  supabase functions deploy mesh-bridge
// Secrets you must set:
//   MESH_SECRET_KEY  = base64 of the server's X25519 SECRET key (32 bytes)
//   (the matching PUBLIC key is embedded in the app; relays only carry
//    ciphertext sealed to that public key, so a relay can never read location)
//
// Generate a keypair once (node):
//   const nacl = require('tweetnacl');
//   const kp = nacl.box.keyPair();
//   console.log('PUBLIC ', Buffer.from(kp.publicKey).toString('base64'));
//   console.log('SECRET ', Buffer.from(kp.secretKey).toString('base64'));

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import nacl from 'https://esm.sh/tweetnacl@1.0.3';
import sealedbox from 'https://esm.sh/tweetnacl-sealedbox-js@1.2.0';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type MeshPayload = {
  v: number; // schema version
  uid: string; // victim user id
  lat: number;
  lng: number;
  ts: number; // ms epoch when the SOS started
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: { msgId?: string; sealed?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const { msgId, sealed } = body;
  if (!msgId || !sealed) return json({ error: 'missing msgId or sealed' }, 400);

  const secretB64 = Deno.env.get('MESH_SECRET_KEY');
  if (!secretB64) return json({ error: 'server not configured' }, 500);

  // Unseal. The keypair's PUBLIC key is embedded in the app; only this function
  // has the SECRET key, so relays that carried the blob could never read it.
  let payload: MeshPayload;
  try {
    const secret = b64ToBytes(secretB64);
    const publicKey = nacl.box.keyPair.fromSecretKey(secret).publicKey;
    const opened = sealedbox.open(b64ToBytes(sealed), publicKey, secret);
    if (!opened) throw new Error('open failed');
    payload = JSON.parse(new TextDecoder().decode(opened));
  } catch {
    return json({ error: 'could not unseal' }, 400);
  }

  if (!payload?.uid || typeof payload.lat !== 'number' || typeof payload.lng !== 'number') {
    return json({ error: 'bad payload' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Dedup: many relays may bridge the same SOS. mesh_bridged (msgId primary key)
  // makes the first bridge win and later ones no-op.
  const { error: dupErr } = await admin
    .from('mesh_bridged')
    .insert({ msg_id: msgId, user_id: payload.uid });
  if (dupErr) {
    // Unique violation => already bridged. Anything else, still ack so relays stop.
    return json({ ok: true, deduped: true });
  }

  // Create the SOS exactly like an online one, then fan out.
  const { data: sos, error: sosErr } = await admin
    .from('sos_events')
    .insert({
      user_id: payload.uid,
      lat: payload.lat,
      lng: payload.lng,
      status: 'active',
      source: 'mesh',
      created_at: new Date(payload.ts || Date.now()).toISOString(),
    })
    .select('id')
    .single();
  if (sosErr) return json({ error: 'could not create sos', detail: sosErr.message }, 500);

  // Reuse the normal push fan-out.
  try {
    await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/notify-sos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
      },
      body: JSON.stringify({ sosId: sos.id }),
    });
  } catch {
    // The SOS row exists regardless; push fan-out is best-effort.
  }

  return json({ ok: true, sosId: sos.id });
});
