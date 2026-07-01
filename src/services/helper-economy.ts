import { supabase } from './supabase';

// Helper economy: real DB-backed earnings + payout requests.
// Money is handled in PAISE end-to-end (matches sql/28) to avoid float errors.
// Earnings are credited by an admin (admin_credit_earning) until an automated
// reward source is defined; payouts are requested here and fulfilled by the
// founder (UPI / RazorpayX) then marked paid in the admin portal.

export type HelperStats = {
  helped: number;
  balancePaise: number;
  earnedPaise: number;
  verified: boolean;
};

export type PayoutMethod = 'upi' | 'bank';

export function formatRupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/** Live stats for the signed-in helper (helped count, balance, total earned). */
export async function loadHelperStats(): Promise<HelperStats | null> {
  try {
    const { data, error } = await supabase.rpc('helper_stats').single();
    if (error || !data) return null;
    const r = data as {
      helped: number;
      balance_paise: number;
      earned_paise: number;
      verified: boolean;
    };
    return {
      helped: r.helped ?? 0,
      balancePaise: r.balance_paise ?? 0,
      earnedPaise: r.earned_paise ?? 0,
      verified: !!r.verified,
    };
  } catch {
    return null;
  }
}

export type PayoutInput = {
  amountPaise: number;
  method: PayoutMethod;
  upiId?: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
};

/** Request a payout. Returns { ok } or { ok:false, error } with a readable msg. */
export async function requestPayout(
  input: PayoutInput,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  try {
    const { data, error } = await supabase.rpc('request_payout', {
      p_amount_paise: input.amountPaise,
      p_method: input.method,
      p_upi: input.upiId ?? null,
      p_account_name: input.accountName ?? null,
      p_account_number: input.accountNumber ?? null,
      p_ifsc: input.ifsc ?? null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, id: data as number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Payout failed' };
  }
}

export type PayoutRow = {
  id: number;
  amountPaise: number;
  method: PayoutMethod;
  status: 'pending' | 'paid' | 'rejected';
  createdAt: string;
};

/** The helper's own payout history. */
export async function loadMyPayouts(): Promise<PayoutRow[]> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return [];
    const { data } = await supabase
      .from('payout_requests')
      .select('id, amount_paise, method, status, created_at')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    return (data ?? []).map((r) => ({
      id: r.id as number,
      amountPaise: r.amount_paise as number,
      method: r.method as PayoutMethod,
      status: r.status as PayoutRow['status'],
      createdAt: r.created_at as string,
    }));
  } catch {
    return [];
  }
}
