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
};

type PublicUserRow = {
  id: string;
  username: string;
  name: string | null;
  photo_url: string | null;
};

function rowToUser(row: PublicUserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    photoUri: row.photo_url,
  };
}

// Push the signed-in user's public record. Called from profile-sync after
// every profile change so search results stay fresh.
export async function syncUsersPublic(profile: UserProfile): Promise<void> {
  if (!profile.username) return;
  try {
    const { error } = await supabase.from('users_public').upsert(
      {
        id: profile.uid,
        username: profile.username,
        name: profile.name,
        photo_url: profile.photoUri,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) console.warn('[users-public] upsert error', error.message);
  } catch (err) {
    console.warn('[users-public] threw', err);
  }
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
