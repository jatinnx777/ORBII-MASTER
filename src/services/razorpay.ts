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
  // 1. The order MUST come from the server. Without a server order there is no
  //    signature to verify later, which means no way to prove the payment was
  //    real — so we refuse to open checkout at all rather than take money we
  //    can't verify (or hand out premium we can't justify).
  let order:
    | { orderId: string; amount: number; currency?: string; keyId?: string }
    | null = null;
  try {
    const { data } = await supabase.functions.invoke('create-order', {
      body: { plan },
    });
    if (data?.orderId) order = data;
  } catch {
    // fall through to the guard below
  }
  if (!order?.orderId) {
    return {
      ok: false,
      error:
        'Payments are not set up yet. Deploy the create-order and verify-payment functions first.',
    };
  }

  const keyId = order.keyId ?? RAZORPAY_TEST_KEY_ID;
  const amount = order.amount ?? PLAN_AMOUNT[plan];

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

  // 3. The ONLY way premium is ever granted: the server re-checks Razorpay's
  //    HMAC signature and writes the entitlement with the service-role key.
  //    There is deliberately no "trust the client" fallback — a device can
  //    always fake a checkout callback, so an unverified success grants nothing.
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
    return { ok: false, error: 'Payment could not be verified. You have not been charged for premium.' };
  }
  await setLocalTier(plan === 'family' ? 'family' : 'plus');
  return { ok: true };
}

// ORBII Plus lasts one month from purchase. We expire it client-side off the
// server `purchase_date` so a reinstall within the month stays active, but the
// subscription is dismissed once the month is up.
const PLUS_VALID_DAYS = 30;

/// Reads the user's entitlement so premium persists across re-login / reinstall
/// — but only while it's within the 1-month validity window. This row can only
/// ever be written by the verify-payment Edge Function (service role), so it is
/// the authoritative answer to "did this person actually pay?".
///
/// 'unknown' means WE COULD NOT ASK (offline, server down, no session yet). It
/// is not the same as 'none', and conflating the two is what silently deleted
/// people's subscriptions: one failed read on a train and premium was gone.
export async function fetchEntitlementTier(): Promise<PremiumTier | 'unknown'> {
  const uid = await currentUid();
  if (!uid) return 'unknown';
  try {
    const { data, error } = await supabase
      .from('entitlements')
      .select('premium_enabled, status, purchase_date, plan_type')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) return 'unknown';
    if (!data?.premium_enabled || data.status !== 'active') return 'none';
    const purchasedAt = data.purchase_date ? Date.parse(data.purchase_date) : 0;
    if (!purchasedAt) return 'none';
    if (Date.now() - purchasedAt > PLUS_VALID_DAYS * 24 * 60 * 60 * 1000) return 'none';
    return data.plan_type === 'family' ? 'family' : 'plus';
  } catch {
    return 'unknown';
  }
}

/// The signed-in user's id, read from the LOCAL session.
///
/// This used to call `supabase.auth.getUser()`, which is a network round-trip to
/// the auth server. Every uid-scoped premium record was therefore gated on a
/// request that fails offline or on a slow first frame after sign-in — and a
/// null uid reads as "no premium". `getSession()` reads the persisted session
/// from disk and never leaves the device.
async function currentUid(): Promise<string | null> {
  try {
    return (await supabase.auth.getSession()).data.session?.user?.id ?? null;
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

async function couponPremiumActive(uid: string): Promise<boolean> {
  const rec = await getItem<CouponRecord | number>(storageKeys.premiumCoupon);
  // Legacy unscoped records (a bare timestamp) granted premium to EVERY account
  // on the device. Ignore them so the grant is dropped rather than inherited.
  if (!rec || typeof rec === 'number') return false;
  if (rec.uid !== uid) return false;
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

async function localTier(uid: string): Promise<PremiumTier> {
  const rec = await getItem<TierRecord>(storageKeys.premiumTier);
  if (!rec?.tier) return 'none';
  // A different account, or a legacy unscoped record → no grant.
  if (rec.uid !== uid) return 'none';
  if (!withinWindow(rec.at)) return 'none';
  return rec.tier;
}

/// Which tier is active right now, or `null` when we genuinely could not tell.
///
/// Precedence matters. The SERVER entitlement wins — it's the only record that
/// proves a real, signature-verified payment, and it survives reinstall. The
/// local records are secondary: the ORBII coupon is a deliberate free grant,
/// and the local tier is just a cached echo of a verified purchase so the
/// Plans screen renders correctly offline. Neither can invent a paid tier the
/// server doesn't know about.
///
/// `null` is the important case. Downgrading somebody to free because a read
/// failed is a bug that looks exactly like theft to the person who paid, so an
/// unanswerable question returns null and callers leave the tier untouched.
/// Only a successful server read that says "nothing here", with no local grant
/// either, is allowed to return 'none'.
export async function resolvePremiumTier(): Promise<PremiumTier | null> {
  const uid = await currentUid();
  if (!uid) return null; // no session yet — ask again once there is one

  const [serverTier, coupon, local] = await Promise.all([
    fetchEntitlementTier(),
    couponPremiumActive(uid),
    localTier(uid),
  ]);

  if (serverTier === 'plus' || serverTier === 'family') return serverTier;
  if (coupon) return 'plus';
  // Offline echo of a previously verified purchase (uid-scoped, 1-month window).
  if (local !== 'none') return local;
  // Nothing local to fall back on and the server never answered.
  if (serverTier === 'unknown') return null;
  return 'none';
}
