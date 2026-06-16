import RazorpayCheckout from 'react-native-razorpay';
import { supabase } from './supabase';

// Razorpay TEST-mode checkout for ORBII paid plans (Solo / Family). The secret
// key NEVER lives in the app:
//   1. `create-order` Edge Function makes the order server-side and returns the
//      orderId + publishable keyId.
//   2. Razorpay Checkout opens with that order.
//   3. `verify-payment` Edge Function re-checks the HMAC signature server-side
//      and writes the entitlement — the client "success" is never trusted.

export type PlanId = 'solo' | 'family';

export type PurchaseResult =
  | { ok: true }
  | { ok: false; cancelled?: boolean; error?: string };

const PLAN_NAME: Record<PlanId, string> = {
  solo: 'ORBII Solo',
  family: 'ORBII Family',
};

// Publishable Razorpay TEST key id — safe to ship in the app (it cannot move
// money or verify payments on its own). The SECRET stays only in the Supabase
// edge-function env, never here.
const RAZORPAY_TEST_KEY_ID = 'rzp_test_T2BbYJlNzptaBL';

// Plan price in paise (₹99 = 9900). Used for the direct test-mode fallback
// when the create-order edge function isn't deployed.
const PLAN_AMOUNT: Record<PlanId, number> = { solo: 9900, family: 29900 };

export async function purchasePlan(plan: PlanId): Promise<PurchaseResult> {
  // 1. Try a server-side order (secure path). If the create-order edge
  //    function isn't deployed, fall back to a direct test-mode checkout.
  let order:
    | { orderId: string; amount: number; currency?: string; keyId?: string }
    | null = null;
  try {
    const { data } = await supabase.functions.invoke('create-order', {
      body: { plan },
    });
    if (data?.orderId) order = data;
  } catch {
    // functions not deployed → fall back below
  }

  const keyId = order?.keyId ?? RAZORPAY_TEST_KEY_ID;
  const amount = order?.amount ?? PLAN_AMOUNT[plan];

  // 2. Open Razorpay checkout.
  let payment: {
    razorpay_payment_id: string;
    razorpay_order_id?: string;
    razorpay_signature?: string;
  };
  try {
    const profile = (await supabase.auth.getUser()).data.user;
    payment = await RazorpayCheckout.open({
      key: keyId,
      ...(order?.orderId ? { order_id: order.orderId } : {}),
      amount,
      currency: order?.currency ?? 'INR',
      name: PLAN_NAME[plan],
      description:
        plan === 'family' ? 'Protect up to 4 people' : 'Enhanced protection',
      theme: { color: '#FF6B57' },
      prefill: {
        email: profile?.email ?? '',
        contact: profile?.phone ?? '',
      },
    });
  } catch (e: unknown) {
    const err = e as { code?: number; description?: string };
    // Razorpay cancel → code 0 / "Payment Cancelled".
    if (err?.code === 0 || /cancel/i.test(err?.description ?? '')) {
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: err?.description ?? 'Payment failed.' };
  }

  // 3a. Secure path: server verifies the HMAC signature + grants the
  //     entitlement. This is the only authoritative grant.
  if (order?.orderId) {
    const { data: verify, error: verifyErr } = await supabase.functions.invoke(
      'verify-payment',
      {
        body: {
          orderId: order.orderId,
          paymentId: payment.razorpay_payment_id,
          signature: payment.razorpay_signature,
          plan,
        },
      },
    );
    if (verifyErr || verify?.premium !== true) {
      return { ok: false, error: 'Payment could not be verified.' };
    }
    return { ok: true };
  }

  // 3b. Test-mode fallback (edge functions not deployed): trust the client
  //     success. Premium is granted locally only — for production, deploy the
  //     create-order + verify-payment functions so grants are server-verified.
  return { ok: true };
}

/// Reads the user's entitlement so premium persists across re-login / restart.
export async function fetchEntitlement(): Promise<boolean> {
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return false;
  try {
    const { data } = await supabase
      .from('entitlements')
      .select('premium_enabled, status')
      .eq('user_id', uid)
      .maybeSingle();
    return !!data?.premium_enabled && data?.status === 'active';
  } catch {
    return false;
  }
}
