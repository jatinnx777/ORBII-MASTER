import { supabase } from './supabase';

// Admin: review + approve responder applications. All three functions are gated
// server-side by is_admin() (sql/27), so a non-admin calling them gets nothing /
// a raised error. Approving runs admin_approve_responder, which sets ALL of
// profiles.role='responder', profiles.is_verified=true, and
// helper_profiles.verification_status='verified' in one shot, so a responder is
// never left half-verified (dispatched but earning no coins, or vice versa).

export type ResponderApplication = {
  userId: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  verificationStatus: 'pending' | 'verified' | 'suspended';
  submittedAt: string | null;
  createdAt: string;
};

export async function listResponders(): Promise<ResponderApplication[]> {
  const { data, error } = await supabase.rpc('admin_list_responders');
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    name: (r.name as string) ?? null,
    email: (r.email as string) ?? null,
    phone: (r.phone as string) ?? null,
    category: (r.category as string) ?? null,
    verificationStatus: (r.verification_status as ResponderApplication['verificationStatus']) ?? 'pending',
    submittedAt: (r.submitted_at as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export async function approveResponder(uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('admin_approve_responder', { target: uid });
  return !error;
}

export async function rejectResponder(uid: string): Promise<boolean> {
  const { error } = await supabase.rpc('admin_reject_responder', { target: uid });
  return !error;
}
