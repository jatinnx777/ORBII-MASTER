import { supabase } from './supabase';

// ORBII coins: how verified helpers are paid for a confirmed, in-person rescue.
// 10 coins = ₹1. 200 coins (₹20) per confirmed help. Redeemable at 500+ (₹50).
// The award happens server-side inside submit_arrival_code (sql/56), so the app
// only ever reads the wallet and requests a redemption.

export type CoinTransaction = {
  delta: number;
  reason: string;
  created_at: string;
};

export type CoinWallet = {
  balance: number;
  rupees: number;
  canRedeem: boolean;
  minRedeem: number;
  transactions: CoinTransaction[];
};

export async function getCoinWallet(): Promise<CoinWallet | null> {
  const { data, error } = await supabase.rpc('get_coin_wallet');
  if (error || !data) return null;
  const d = data as {
    balance: number;
    rupees: number;
    can_redeem: boolean;
    min_redeem: number;
    transactions: CoinTransaction[];
  };
  return {
    balance: d.balance ?? 0,
    rupees: d.rupees ?? 0,
    canRedeem: !!d.can_redeem,
    minRedeem: d.min_redeem ?? 500,
    transactions: d.transactions ?? [],
  };
}

export type RedeemResult =
  | { ok: true; coins: number; rupees: number }
  | { ok: false; reason: 'below_min' | 'error'; balance?: number };

export async function requestCoinRedemption(): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('request_coin_redemption');
  if (error || !data) return { ok: false, reason: 'error' };
  const d = data as { ok: boolean; reason?: string; balance?: number; coins?: number; rupees?: number };
  if (d.ok) return { ok: true, coins: d.coins ?? 0, rupees: d.rupees ?? 0 };
  return { ok: false, reason: d.reason === 'below_min' ? 'below_min' : 'error', balance: d.balance };
}

// How many free verified-helper dispatches the user has left this month (free
// plan is 2/month; Plus is unlimited so this is only shown to free users).
export async function getFreeHelpsLeft(): Promise<{ used: number; limit: number; left: number } | null> {
  const { data, error } = await supabase.rpc('get_free_helps_left');
  if (error || !data) return null;
  const d = data as { used: number; limit: number; left: number };
  return { used: d.used ?? 0, limit: d.limit ?? 2, left: d.left ?? 2 };
}

// Human label for a transaction reason.
export function coinReasonLabel(reason: string): string {
  switch (reason) {
    case 'help_confirmed':
      return 'Helped someone (confirmed)';
    case 'redemption':
      return 'Redeemed for cash';
    default:
      return reason.replace(/_/g, ' ');
  }
}
