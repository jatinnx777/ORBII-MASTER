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
  // E.164 phone (e.g. "+919876543210"). Optional — populated when the
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
    // Phone is never returned by directory reads anymore (sql/18) — only the
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
export async function findUserByPhone(
  phoneE164: string,
  excludeUid: string,
): Promise<PublicUser | null> {
  if (!phoneE164.startsWith('+')) return null;
  // Phone is no longer a readable column on users_public (see sql/18). We
  // resolve it through a SECURITY DEFINER RPC that does an exact match and
  // never returns the number — so the directory can't be scraped.
  const { data, error } = await supabase.rpc('find_user_by_phone', {
    p_phone: phoneE164,
    p_exclude: excludeUid,
  });
  if (error) {
    console.warn('[users-public] phone search error', error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return row ? rowToUser({ ...row, phone: null }) : null;
}

// User search by username OR name. Substring match (matches middle, not
// just prefix). Excludes the caller. Capped at 10 results.
export async function searchUsers(args: {
  query: string;
  excludeUid: string;
}): Promise<PublicUser[]> {
  const q = args.query.trim().toLowerCase();
  if (q.length < 2) return [];
  // Postgres `ilike` treats % and _ as wildcards. Escape any in the user
  // input so a literal underscore in a username doesn't match every char.
  const escaped = q.replace(/[%_]/g, '\\$&');
  const { data, error } = await supabase
    .from('users_public')
    .select('id, username, name, photo_url')
    .or(`username.ilike.%${escaped}%,name.ilike.%${escaped}%`)
    .neq('id', args.excludeUid)
    .order('username', { ascending: true })
    .limit(10);
  if (error) {
    console.warn('[users-public] search error:', error.message);
    return [];
  }
  console.log(
    `[users-public] search "${q}" → ${data?.length ?? 0} result(s)`,
  );
  if (!data) return [];
  return (data as PublicUserRow[]).map(rowToUser);
}

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
    // Network / RLS failure — be permissive so profile setup doesn't
    // soft-block the user. The DB unique constraint is the final guard.
    console.warn('[users-public] availability check failed:', error.message);
    return true;
  }
  if (!data) return true;
  return excludeUid != null && data.id === excludeUid;
}
