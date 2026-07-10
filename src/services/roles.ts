import { useAppSelector } from '@/redux/store';
import { store } from '@/redux/store';
import { profileUpdated } from '@/redux/slices/userSlice';
import { supabase } from './supabase';
import { reportError } from './error-reporting';
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
export type ApplyResult = { ok: true } | { ok: false; error: string };

/**
 * Submit an application to become a responder (creates a pending profile).
 *
 * Returns the REAL failure rather than a bare false. This used to swallow the
 * error and the UI blamed the user's connection — so a missing `apply_as_responder`
 * function (sql/24_roles.sql never run) looked exactly like bad wifi, and the
 * actual cause was invisible to everyone.
 */
export async function applyAsResponder(): Promise<ApplyResult> {
  try {
    const { error } = await supabase.rpc('apply_as_responder');
    if (error) {
      reportError(error, {
        category: 'responder.apply',
        message: 'apply_as_responder failed',
        data: { code: error.code, hint: error.hint, details: error.details },
      });
      // PostgREST reports a missing function as 404 / PGRST202.
      const missing =
        error.code === 'PGRST202' || /function .* does not exist/i.test(error.message);
      return {
        ok: false,
        error: missing
          ? 'Responder applications are not set up on the server yet.'
          : error.message,
      };
    }
    return { ok: true };
  } catch (err) {
    reportError(err, { category: 'responder.apply', message: 'apply_as_responder threw' });
    return { ok: false, error: 'Could not reach the server. Check your connection.' };
  }
}

export async function refreshUserRole(): Promise<void> {
  try {
    const uid = store.getState().user.profile?.uid;
    if (!uid) return;
    const { data, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', uid)
      .maybeSingle();
    if (error) {
      // A missing `role` column (sql/24_roles.sql never run) silently pinned
      // every user to 'user' — so an approved responder never saw the Missions
      // tab and nobody knew why. Report it once, don't guess.
      reportError(error, {
        category: 'responder.role',
        message: 'could not read profiles.role — responders will never appear',
        data: { code: error.code, hint: error.hint },
      });
      return;
    }
    const role = (data?.role as UserRole | undefined) ?? 'user';
    const profile = store.getState().user.profile;
    if (profile && profile.role !== role) {
      store.dispatch(profileUpdated({ ...profile, role }));
    }
  } catch {
    // best-effort — keep whatever role we had
  }
}
