import { supabase } from './supabase';

// Redeem a coupon code for ORBII Plus. The server (redeem_coupon, sql/59)
// validates the code and writes the entitlement, so a valid redemption survives
// reinstall like a real subscription.

export type RedeemReason = 'invalid' | 'expired' | 'exhausted' | 'already' | 'error';

export type RedeemCouponResult =
  | { ok: true; plan: 'plus' | 'family' }
  | { ok: false; reason: RedeemReason };

export async function redeemCoupon(code: string): Promise<RedeemCouponResult> {
  const clean = code.trim();
  if (!clean) return { ok: false, reason: 'invalid' };
  try {
    const { data, error } = await supabase.rpc('redeem_coupon', { p_code: clean });
    if (error || !data) return { ok: false, reason: 'error' };
    const d = data as { ok: boolean; plan?: string; reason?: RedeemReason };
    if (d.ok) return { ok: true, plan: d.plan === 'family' ? 'family' : 'plus' };
    return { ok: false, reason: d.reason ?? 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export function redeemReasonMessage(reason: RedeemReason): string {
  switch (reason) {
    case 'invalid':
      return "That code isn't valid. Check for typos and try again.";
    case 'expired':
      return 'That coupon has expired.';
    case 'exhausted':
      return 'That coupon has been fully used up.';
    case 'already':
      return "You've already redeemed this coupon.";
    default:
      return 'Could not redeem right now. Please try again.';
  }
}
