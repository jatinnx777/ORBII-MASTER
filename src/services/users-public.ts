// PEOPLE SEARCH WAS REMOVED HERE, deliberately and not by refactor.
//
// This file used to export findUserByPhone and searchUsers, the two calls that
// let one account look another one up by number or by name. Both were careful:
// exact match only, the phone number never returned, a SECURITY DEFINER
// wrapper so users_public itself stayed unreadable, rate limits on top.
//
// Every one of those was a mitigation of a hole that did not need to exist,
// and the thing being mitigated was a searchable index of women who installed
// a personal safety app.
//
// Circles are joined with a six letter code now (sql/125). Nothing is looked
// up, nothing is enumerable, and the person joining has to have been told the
// code by somebody who has it. The RPCs behind these functions are revoked
// from `authenticated` rather than dropped, so an older installed build that
// still calls them gets a permission error it already handles as "no results"
// instead of a crash.

import { supabase } from './supabase';
import type { UserProfile } from '@/types';

// `users_public` is a thin, world-readable directory keyed by uid + username.
// It's how the friend-search UI finds people, and how friend rows enrich
// themselves with name + photo without leaking the rest of the profile.
//
// SQL schema lives in sql/01_friend_system.sql.

export type PublicUser = {
  id: string;
  username: string;
  name: string | null;
  photoUri: string | null;
  // E.164 phone (e.g. "+919876543210"). Optional, populated when the
  // user has set their phone during sign-up. Used by the phone-number
  // circle invite flow to find registered friends.
  phone: string | null;
};

type PublicUserRow = {
  id: string;
  username: string;
  name: string | null;
  photo_url: string | null;
  // Only present on the user's own record; directory reads omit it (sql/18).
  phone?: string | null;
};

function rowToUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    photoUri: row.photo_url,
    // Phone is never returned by directory reads anymore (sql/18), only the
    // user's own record carries it, set locally during profile sync.
    phone: row.phone ?? null,
  };
}

// Push the signed-in user's public record. Called from profile-sync after
// every profile change so search results stay fresh. Now also stores
// `phone` so the circle-invite flow can match registered friends by
// phone number.
export async function syncUsersPublic(profile: UserProfile): Promise<void> {
  if (!profile.username) return;
  try {
    const { error } = await supabase.from('users_public').upsert(
      {
        id: profile.uid,
        username: profile.username,
        name: profile.name,
        photo_url: profile.photoUri,
        phone: profile.phone ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) console.warn('[users-public] upsert error', error.message);
  } catch (err) {
    console.warn('[users-public] threw', err);
  }
}

// Look up a registered ORBII user by their E.164 phone. Used by the
// circle-invite flow to make sure the invitee already has an account
// before sending a friend request.
// User search by username OR name. Substring match (matches middle, not
// just prefix). Excludes the caller. Capped at 10 results.
// Bulk-fetch public records by usernames. Used when hydrating the friends
// list on sign-in.
export async function getPublicUsersByUsernames(
  usernames: string[],
): Promise<Map<string, PublicUser>> {
  const out = new Map<string, PublicUser>();
  if (usernames.length === 0) return out;
  const { data, error } = await supabase
    .from('users_public')
    .select('id, username, name, photo_url')
    .in('username', usernames);
  if (error || !data) return out;
  (data as PublicUserRow[]).forEach((row) => {
    out.set(row.username, rowToUser(row));
  });
  return out;
}

export async function getPublicUserByUsername(
  username: string,
): Promise<PublicUser | null> {
  const { data, error } = await supabase
    .from('users_public')
    .select('id, username, name, photo_url')
    .eq('username', username)
    .maybeSingle<PublicUserRow>();
  if (error || !data) return null;
  return rowToUser(data);
}

// True if `username` is free, or already owned by `excludeUid`. Used during
// profile setup to enforce one-username-per-user before the upsert hits the
// unique constraint at the DB level (which would otherwise surface as a
// generic "duplicate key" error).
export async function isUsernameAvailable(
  username: string,
  excludeUid: string | null,
): Promise<boolean> {
  const u = username.trim().toLowerCase();
  if (!u) return false;
  const { data, error } = await supabase
    .from('users_public')
    .select('id, username')
    .eq('username', u)
    .maybeSingle<{ id: string; username: string }>();
  if (error) {
    // Network / RLS failure, be permissive so profile setup doesn't
    // soft-block the user. The DB unique constraint is the final guard.
    console.warn('[users-public] availability check failed:', error.message);
    return true;
  }
  if (!data) return true;
  return excludeUid != null && data.id === excludeUid;
}
