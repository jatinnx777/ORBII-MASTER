// Supabase Edge Function: create-order
// ----------------------------------------------------------------------------
// Creates a Razorpay order SERVER-SIDE so the secret key never touches the app.
// The Flutter client calls this, gets back an order_id, and opens Checkout with
// it. TEST MODE: set the function secrets to your rzp_test_* credentials.
//
//   supabase secrets set RAZORPAY_KEY_ID=rzp_test_xxx RAZORPAY_KEY_SECRET=yyy
//   supabase functions deploy create-order
//
// Request  : { "plan": "plus" }
// Response : { "orderId", "amount", "currency", "keyId" }
// ----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';

// Plan prices in paise (₹99 = 9900). Mirrors the RN tiers: Solo + Family.
const PLAN_AMOUNT: Record<string, number> = {
  solo: 9900, // ₹99/mo
  family: 29900, // ₹299/mo
  plus: 9900, // legacy alias → Solo
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // Require a valid Supabase auth token (the caller must be signed in).
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      return json({ error: 'unauthorized' }, 401);
    }

    const { plan = 'plus' } = await req.json().catch(() => ({}));
    const amount = PLAN_AMOUNT[plan];
    if (!amount) return json({ error: 'unknown_plan' }, 400);

    // Razorpay Orders API (Basic auth = key_id:key_secret).
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${KEY_ID}:${KEY_SECRET}`)}`,
      },
      body: JSON.stringify({
        amount,
        currency: 'INR',
        receipt: `orbii_${userData.user.id}_${Date.now()}`,
        notes: { user_id: userData.user.id, plan },
      }),
    });
    const order = await res.json();
    if (!res.ok) return json({ error: 'order_failed', detail: order }, 502);

    return json({
      orderId: order.id,
      amount,
      currency: 'INR',
      keyId: KEY_ID,
    });
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
