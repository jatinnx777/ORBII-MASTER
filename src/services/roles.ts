import { useAppSelector } from '@/redux/store';
import { store } from '@/redux/store';
import { profileUpdated } from '@/redux/slices/userSlice';
import { supabase } from './supabase';
import type { UserRole } from '@/types';

// Role-based permissions for ORBII. ONE app, ONE account — the role decides
// which UI a user can see. Keep all role logic here so we never hardcode
// `role === 'x'` checks scattered across screens.

export const ROLES: Record<UserRole, UserRole> = {
  user: 'user',
  responder: 'responder',
  admin: 'admin',
};

export function isResponder(role: UserRole | undefined): boolean {
  return role === 'responder' || role === 'admin';
}

export function isAdmin(role: UserRole | undefined): boolean {
  return role === 'admin';
}

/** Responders (and admins) unlock the Missions tab + responder dashboard. */
export function canSeeMissions(role: UserRole | undefined): boolean {
  return isResponder(role);
}

// ── hooks ─────────────────────────────────────────────────
export function useRole(): UserRole {
  return useAppSelector((s) => s.user.profile?.role ?? 'user');
}

export function useIsResponder(): boolean {
  return isResponder(useRole());
}

export function useIsAdmin(): boolean {
  return isAdmin(useRole());
}

// ── server sync ───────────────────────────────────────────
// Pull the authoritative role from profiles.role and merge it into the local
// profile, so navigation updates the moment an admin approves a responder.
/** Submit an application to become a responder (creates a pending profile). */
export async function applyAsResponder(): Promise<boolean> {
  try {
    const { error } = await supabase.rpc('apply_as_responder');
    return !error;
  } catch {
    return false;
  }
}

export async function refreshUserRole(): Promise<void> {
  try {
    const uid = store.getState().user.profile?.uid;
    if (!uid) return;
    const { data } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .maybeSingle();
    const role = (data?.role as UserRole | undefined) ?? 'user';
    const profile = store.getState().user.profile;
    if (profile && profile.role !== role) {
      store.dispatch(profileUpdated({ ...profile, role }));
    }
  } catch {
    // best-effort — keep whatever role we had
  }
}
