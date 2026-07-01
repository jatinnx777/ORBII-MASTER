import { supabase } from './supabase';

// Responder profile for the ORBII Helpers app — verification + trust +
// recognition (NOT earnings). Backed by helper_profiles (sql/23).

export type VerificationStatus = 'pending' | 'verified' | 'suspended';
export type GuardianLevel = 'Bronze' | 'Silver' | 'Gold' | 'Elite';

export type HelperProfile = {
  userId: string;
  verificationStatus: VerificationStatus;
  category: string | null;
  trainingDone: boolean;
  trustScore: number;
  lifetimeResponses: number;
  aadhaarVerified: boolean;
  panVerified: boolean;
  faceVerified: boolean;
  // Uploaded KYC document paths (private bucket). Presence = uploaded.
  aadhaarDoc: string | null;
  panDoc: string | null;
  selfieDoc: string | null;
  photoDoc: string | null;
  submittedAt: string | null;
};

type Row = {
  user_id: string;
  verification_status: VerificationStatus;
  category: string | null;
  training_done: boolean;
  trust_score: number;
  lifetime_responses: number;
  aadhaar_verified: boolean;
  pan_verified: boolean;
  face_verified: boolean;
  aadhaar_doc?: string | null;
  pan_doc?: string | null;
  selfie_doc?: string | null;
  photo_doc?: string | null;
  submitted_at?: string | null;
};

function fromRow(r: Row): HelperProfile {
  return {
    userId: r.user_id,
    verificationStatus: r.verification_status,
    category: r.category,
    trainingDone: r.training_done,
    trustScore: r.trust_score,
    lifetimeResponses: r.lifetime_responses,
    aadhaarVerified: r.aadhaar_verified,
    panVerified: r.pan_verified,
    faceVerified: r.face_verified,
    aadhaarDoc: r.aadhaar_doc ?? null,
    panDoc: r.pan_doc ?? null,
    selfieDoc: r.selfie_doc ?? null,
    photoDoc: r.photo_doc ?? null,
    submittedAt: r.submitted_at ?? null,
  };
}

// Recognition tier from contribution + trust (Bronze → Elite).
export function guardianLevel(p: HelperProfile): GuardianLevel {
  const { lifetimeResponses: n, trustScore: t } = p;
  if (n >= 150 && t >= 90) return 'Elite';
  if (n >= 50 && t >= 75) return 'Gold';
  if (n >= 10 && t >= 60) return 'Silver';
  return 'Bronze';
}

export function isFullyVerified(p: HelperProfile): boolean {
  return (
    p.verificationStatus === 'verified' &&
    p.aadhaarVerified &&
    p.panVerified &&
    p.faceVerified &&
    p.trainingDone
  );
}

/** Load the signed-in user's helper profile, creating a pending one if absent. */
export async function loadHelperProfile(userId: string): Promise<HelperProfile | null> {
  try {
    const { data } = await supabase
      .from('helper_profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (data) return fromRow(data as Row);
    // First open → create a pending profile.
    const { data: created } = await supabase
      .from('helper_profiles')
      .insert({ user_id: userId })
      .select('*')
      .maybeSingle();
    return created ? fromRow(created as Row) : null;
  } catch {
    return null;
  }
}

export async function setHelperCategory(category: string): Promise<void> {
  try {
    await supabase.auth.getSession();
    const uid = (await supabase.auth.getUser()).data.user?.id;
    if (!uid) return;
    await supabase.from('helper_profiles').update({ category }).eq('user_id', uid);
  } catch {
    // best-effort
  }
}

export async function recordHelperResponse(): Promise<void> {
  try {
    await supabase.rpc('increment_helper_responses');
  } catch {
    // best-effort
  }
}
