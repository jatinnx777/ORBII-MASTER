import RazorpayCheckout from 'react-native-razorpay';
import { supabase } from './supabase';
import { getItem, setItem, storageKeys } from './storage';

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

export type TipResult = { ok: true; paymentId: string } | { ok: false; cancelled?: boolean; error?: string };

// A voluntary thank-you tip to a responder after they've helped. Uses the same
// Razorpay TEST checkout. The tip is credited to the helper's ORBII wallet
// server-side (record-tip); until that edge function is deployed the payment
// still succeeds in test mode so the flow is fully demoable.
export async function tipHelper(
  amountRupees: number,
  helperName: string,
  sosId?: string,
): Promise<TipResult> {
  const amount = Math.round(amountRupees * 100);
  if (amount < 100) return { ok: false, error: 'Minimum tip is ₹1' };
  try {
    const profile = (await supabase.auth.getUser()).data.user;
    const payment = await RazorpayCheckout.open({
      key: RAZORPAY_TEST_KEY_ID,
      amount,
      currency: 'INR',
      name: 'ORBII',
      description: `Thank ${helperName || 'your helper'}`,
      theme: { color: '#7BC47F' },
      prefill: { email: profile?.email ?? '', contact: profile?.phone ?? '' },
    });
    void supabase.functions
      .invoke('record-tip', {
        body: { sosId, amountPaise: amount, paymentId: payment.razorpay_payment_id },
      })
      .catch(() => undefined);
    return { ok: true, paymentId: payment.razorpay_payment_id };
  } catch (e: unknown) {
    const err = e as { code?: number; description?: string };
    if (err?.code === 0 || /cancel/i.test(err?.description ?? '')) {
      return { ok: false, cancelled: true };
    }
    return { ok: false, error: err?.description ?? 'Tip failed' };
  }
}

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

// ORBII Plus lasts one month from purchase. We expire it client-side off the
// server `purchase_date` so a reinstall within the month stays active, but the
// subscription is dismissed once the month is up.
const PLUS_VALID_DAYS = 30;

/// Reads the user's entitlement so premium persists across re-login / reinstall
/// — but only while it's within the 1-month validity window.
export async function fetchEntitlement(): Promise<boolean> {
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return false;
  try {
    const { data } = await supabase
      .from('entitlements')
      .select('premium_enabled, status, purchase_date')
      .eq('user_id', uid)
      .maybeSingle();
    if (!data?.premium_enabled || data.status !== 'active') return false;
    const purchasedAt = data.purchase_date ? Date.parse(data.purchase_date) : 0;
    if (!purchasedAt) return false;
    const ageMs = Date.now() - purchasedAt;
    return ageMs <= PLUS_VALID_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return false;
  }
}

/// Record an ORBII coupon redemption (also gives one month of Plus).
export async function markCouponRedeemed(): Promise<void> {
  await setItem(storageKeys.premiumCoupon, Date.now());
}

async function couponPremiumActive(): Promise<boolean> {
  const at = await getItem<number>(storageKeys.premiumCoupon);
  if (!at) return false;
  return Date.now() - at <= PLUS_VALID_DAYS * 24 * 60 * 60 * 1000;
}

/// The single source of truth for "is Plus active right now": a paid
/// subscription (server, survives reinstall) OR a coupon redemption (local) —
/// each within the 1-month window. Call on launch to reconcile `isPremium`.
export async function resolvePremiumActive(): Promise<boolean> {
  const [paid, coupon] = await Promise.all([
    fetchEntitlement(),
    couponPremiumActive(),
  ]);
  return paid || coupon;
}
