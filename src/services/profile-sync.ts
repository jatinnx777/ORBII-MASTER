import { supabase } from './supabase';
import type { UserProfile } from '@/types';

// Best-effort profile persistence to Supabase. The expected `profiles`
// table schema (paste into Supabase SQL editor):
//
//   create table profiles (
//     id uuid primary key references auth.users(id) on delete cascade,
//     email text,
//     username text unique,
//     name text,
//     phone text,
//     photo_uri text,
//     is_helper boolean default false,
//     is_verified boolean default false,
//     created_at timestamptz default now(),
//     updated_at timestamptz default now()
//   );
//   alter table profiles enable row level security;
//   create policy "owner read" on profiles for select using (auth.uid() = id);
//   create policy "owner write" on profiles for insert with check (auth.uid() = id);
//   create policy "owner update" on profiles for update using (auth.uid() = id);
//
// Until the table + RLS policies exist this just no-ops. The app stays
// fully functional on local AsyncStorage; once the schema is in place
// every profile change auto-syncs.

let warnedMissingTable = false;

export async function syncProfile(profile: UserProfile): Promise<void> {
  try {
    const { error } = await supabase.from('profiles').upsert(
      {
        id: profile.uid,
        email: profile.email || null,
        username: profile.username,
        name: profile.name,
        phone: profile.phone,
        photo_uri: profile.photoUri,
        is_helper: profile.isHelper,
        is_verified: profile.idVerification === 'verified',
        username_changed_at: profile.usernameChangedAt
          ? new Date(profile.usernameChangedAt).toISOString()
          : null,
        photo_changed_at: profile.photoChangedAt
          ? new Date(profile.photoChangedAt).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (error) {
      // Table missing or RLS blocking. Warn once, never spam.
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn('[profile-sync] not active:', error.message);
      }
    }
  } catch (err) {
    if (!warnedMissingTable) {
      warnedMissingTable = true;
      console.warn('[profile-sync] threw:', err);
    }
  }
}

export async function syncFriend(
  myUid: string,
  friendUsername: string,
): Promise<void> {
  try {
    await supabase.from('friends').upsert(
      {
        user_id: myUid,
        friend_username: friendUsername,
        added_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,friend_username' },
    );
  } catch {
    // ignore — friends table may not exist yet
  }
}

export async function unsyncFriend(
  myUid: string,
  friendUsername: string,
): Promise<void> {
  try {
    await supabase
      .from('friends')
      .delete()
      .match({ user_id: myUid, friend_username: friendUsername });
  } catch {
    // ignore
  }
}
