-- ORBII friend-system migration. Paste this into the Supabase SQL editor and
-- run it once. Idempotent — safe to re-run.
--
-- Adds:
--   users_public  : searchable directory (username + name + photo)
--   messages      : persistent friend-to-friend chat
-- Backfills users_public from existing profiles.
--
-- Existing tables (profiles, friends, friend_requests) are unchanged.

-- ---------------------------------------------------------------------------
-- 1. USERS_PUBLIC — searchable directory
-- ---------------------------------------------------------------------------
create table if not exists users_public (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text,
  photo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Case-insensitive prefix search index.
create index if not exists users_public_username_lower_idx
  on users_public (lower(username));

alter table users_public enable row level security;

drop policy if exists "users_public read all" on users_public;
create policy "users_public read all"
  on users_public for select
  using (true);

drop policy if exists "users_public owner upsert" on users_public;
create policy "users_public owner upsert"
  on users_public for insert
  with check (auth.uid() = id);

drop policy if exists "users_public owner update" on users_public;
create policy "users_public owner update"
  on users_public for update
  using (auth.uid() = id);

-- Backfill from existing profiles (one-time; safe to re-run).
insert into users_public (id, username, name, photo_url)
select id, username, name, photo_uri
from profiles
where username is not null
on conflict (id) do update
  set username = excluded.username,
      name = excluded.name,
      photo_url = excluded.photo_url,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. MESSAGES — persistent direct chat
-- ---------------------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  message text not null,
  created_at timestamptz default now()
);

create index if not exists messages_pair_idx
  on messages (
    least(sender_id, receiver_id),
    greatest(sender_id, receiver_id),
    created_at desc
  );

alter table messages enable row level security;

drop policy if exists "messages read own" on messages;
create policy "messages read own"
  on messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages insert own" on messages;
create policy "messages insert own"
  on messages for insert
  with check (auth.uid() = sender_id);

-- Realtime: enable INSERT broadcasts for messages so subscribers see new rows.
-- (Run once; the publication may already exist.)
alter publication supabase_realtime add table messages;
