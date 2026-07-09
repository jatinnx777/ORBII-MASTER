import { getItem, setItem } from './storage';
import type { UserProfile } from '@/types';

// Durable, per-user cache of the identity fields. SAFETY NET: the profile is
// mirrored to Supabase on a best-effort basis (syncProfile swallows failures if
// the table/RLS/bucket isn't set up), while the session copy is wiped on
// sign-out. Without this, a user who edited their name or photo would come back
// after signing out to find it gone. Keyed by uid so a second account on the
// same phone never inherits someone else's profile.

type CachedProfile = {
  name: string | null;
  username: string | null;
  photoUri: string | null;
  phone: string | null;
  usernameChangedAt: number | null;
  photoChangedAt: number | null;
};

const cacheKey = (uid: string) => `orbii:profile-cache:${uid}`;

export async function cacheProfileLocally(p: UserProfile): Promise<void> {
  if (!p.uid) return;
  await setItem<CachedProfile>(cacheKey(p.uid), {
    name: p.name,
    username: p.username,
    photoUri: p.photoUri,
    phone: p.phone,
    usernameChangedAt: p.usernameChangedAt,
    photoChangedAt: p.photoChangedAt,
  });
}

export async function getCachedProfile(uid: string): Promise<CachedProfile | null> {
  return await getItem<CachedProfile>(cacheKey(uid));
}

export async function clearCachedProfile(uid: string): Promise<void> {
  await setItem<CachedProfile | null>(cacheKey(uid), null);
}

// Fill any field the server didn't return from the local cache. The server
// always wins when it actually has a value.
export async function mergeCachedProfile(p: UserProfile): Promise<UserProfile> {
  const cached = await getCachedProfile(p.uid);
  if (!cached) return p;
  return {
    ...p,
    name: p.name ?? cached.name,
    username: p.username ?? cached.username,
    photoUri: p.photoUri ?? cached.photoUri,
    phone: p.phone ?? cached.phone,
    usernameChangedAt: p.usernameChangedAt ?? cached.usernameChangedAt,
    photoChangedAt: p.photoChangedAt ?? cached.photoChangedAt,
  };
}
