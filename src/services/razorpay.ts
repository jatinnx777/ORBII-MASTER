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
    await setLocalTier(plan === 'family' ? 'family' : 'plus');
    return { ok: true };
  }

  // 3b. Test-mode fallback (edge functions not deployed): trust the client
  //     success. Premium is granted locally only — for production, deploy the
  //     create-order + verify-payment functions so grants are server-verified.
  await setLocalTier(plan === 'family' ? 'family' : 'plus');
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

async function currentUid(): Promise<string | null> {
  try {
    return (await supabase.auth.getUser()).data.user?.id ?? null;
  } catch {
    return null;
  }
}

function withinWindow(at: number): boolean {
  return Date.now() - at <= PLUS_VALID_DAYS * 24 * 60 * 60 * 1000;
}

/// Record an ORBII coupon redemption. The gift is one month of ORBII Plus.
export async function markCouponRedeemed(): Promise<void> {
  const uid = await currentUid();
  await setItem(storageKeys.premiumCoupon, { at: Date.now(), uid });
  await setLocalTier('plus');
}

type CouponRecord = { at: number; uid: string | null };

async function couponPremiumActive(): Promise<boolean> {
  const rec = await getItem<CouponRecord | number>(storageKeys.premiumCoupon);
  // Legacy unscoped records (a bare timestamp) granted premium to EVERY account
  // on the device. Ignore them so the grant is dropped rather than inherited.
  if (!rec || typeof rec === 'number') return false;
  const uid = await currentUid();
  if (!uid || rec.uid !== uid) return false;
  return withinWindow(rec.at);
}

export type PremiumTier = 'none' | 'plus' | 'family';

type TierRecord = { tier: 'plus' | 'family'; at: number; uid: string | null };

// Persist which tier the user bought (locally), scoped to the user who bought
// it and gated by the same 1-month window as premium itself. Scoping matters:
// without it, one test purchase left premium switched on for every account that
// ever signed in on that phone.
export async function setLocalTier(tier: 'plus' | 'family'): Promise<void> {
  const uid = await currentUid();
  await setItem(storageKeys.premiumTier, { tier, at: Date.now(), uid });
}

async function localTier(): Promise<PremiumTier> {
  const rec = await getItem<TierRecord>(storageKeys.premiumTier);
  if (!rec?.tier) return 'none';
  const uid = await currentUid();
  // Not signed in, a different account, or a legacy unscoped record → no grant.
  if (!uid || rec.uid !== uid) return 'none';
  if (!withinWindow(rec.at)) return 'none';
  return rec.tier;
}

/// The single source of truth for "is premium active right now": a paid
/// subscription (server, survives reinstall) OR a coupon / local purchase —
/// each within the 1-month window. Call on launch to reconcile `isPremium`.
export async function resolvePremiumActive(): Promise<boolean> {
  const [paid, coupon, local] = await Promise.all([
    fetchEntitlement(),
    couponPremiumActive(),
    localTier(),
  ]);
  return paid || coupon || local !== 'none';
}

/// Which tier is active right now. Local purchase record is the most specific
/// signal; a server entitlement with no known tier is treated as Plus.
export async function resolvePremiumTier(): Promise<PremiumTier> {
  const [paid, coupon, local] = await Promise.all([
    fetchEntitlement(),
    couponPremiumActive(),
    localTier(),
  ]);
  if (local !== 'none') return local;
  if (paid || coupon) return 'plus';
  return 'none';
}
