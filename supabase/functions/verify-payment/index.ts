// Supabase Edge Function: verify-payment
// ----------------------------------------------------------------------------
// Verifies a Razorpay payment SERVER-SIDE and grants ORBII Plus. The app's
// client-side "success" callback is NEVER trusted — entitlement is written here
// with the service-role key only after the HMAC signature checks out.
//
//   supabase secrets set RAZORPAY_KEY_SECRET=yyy
//   supabase functions deploy verify-payment
//
// Request : { "orderId", "paymentId", "signature", "plan" }
// Response: { "premium": true } | { "error": ... }
// ----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createHmac } from 'node:crypto';

const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    // Identify the caller with the anon client (respects their JWT).
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    const user = userData.user;
    if (!user) return json({ error: 'unauthorized' }, 401);

    const { orderId, paymentId, signature, plan = 'plus' } = await req.json();
    if (!orderId || !paymentId || !signature) {
      return json({ error: 'missing_fields' }, 400);
    }

    // Razorpay signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).
    const expected = createHmac('sha256', KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expected !== signature) {
      return json({ error: 'invalid_signature' }, 400);
    }

    // Signature valid → grant Plus using the SERVICE ROLE (bypasses RLS).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await admin.from('entitlements').upsert({
      user_id: user.id,
      plan_type: plan,
      status: 'active',
      premium_enabled: true,
      purchase_date: new Date().toISOString(),
      razorpay_payment_id: paymentId,
      updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: 'grant_failed', detail: error.message }, 500);

    return json({ premium: true });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
