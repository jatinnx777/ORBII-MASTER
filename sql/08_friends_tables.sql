-- ORBII friend system — creates the `friends` and `friend_requests`
-- tables the app expects. The original sql/01 was supposed to set these
-- up but they never landed in this Supabase project. The app's friend
-- features have been silently failing because of it.
--
-- Schema is derived from the actual queries in:
--   src/services/friend-requests.ts  (select / insert / update)
--   src/services/profile-sync.ts     (upsert / delete)
--
-- Both tables key friends by USERNAME, not uid. That's intentional —
-- usernames are unique in users_public (unique constraint enforced),
-- and the username is the public handle a friend types in to add you.
-- The Friend type on the client carries an optional uid that we
-- hydrate from users_public for chat / SOS priority.
--
-- Idempotent — safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. friend_requests — pending invitations
-- ---------------------------------------------------------------------------
create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references auth.users(id) on delete cascade,
  from_username text not null,
  to_username text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz default now(),
  responded_at timestamptz,
  unique (from_user_id, to_username)
);

alter table public.friend_requests enable row level security;

drop policy if exists "fr send" on public.friend_requests;
create policy "fr send"
  on public.friend_requests for insert
  with check (auth.uid() = from_user_id);

-- A user sees a request if:
--   • they sent it (from_user_id = auth.uid()), OR
--   • they're the recipient (their username == to_username).
drop policy if exists "fr read mine" on public.friend_requests;
create policy "fr read mine"
  on public.friend_requests for select
  using (
    auth.uid() = from_user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = friend_requests.to_username
    )
  );

-- Only the recipient can update status (accept / decline).
drop policy if exists "fr respond" on public.friend_requests;
create policy "fr respond"
  on public.friend_requests for update
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = friend_requests.to_username
    )
  );

-- Either side can delete a request (sender retracts, recipient declines).
drop policy if exists "fr delete" on public.friend_requests;
create policy "fr delete"
  on public.friend_requests for delete
  using (
    auth.uid() = from_user_id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = friend_requests.to_username
    )
  );

-- ---------------------------------------------------------------------------
-- 2. friends — accepted circle members
--    On accept, the client inserts mutual rows (A→B and B→A) so each
--    side sees the other. user_id is the row owner; friend_username is
--    the handle of the person they added.
-- ---------------------------------------------------------------------------
create table if not exists public.friends (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_username text not null,
  added_at timestamptz default now(),
  primary key (user_id, friend_username)
);

alter table public.friends enable row level security;

-- A user can only read / write their own circle.
drop policy if exists "friends read own" on public.friends;
create policy "friends read own"
  on public.friends for select
  using (auth.uid() = user_id);

drop policy if exists "friends write own" on public.friends;
create policy "friends write own"
  on public.friends for insert
  with check (auth.uid() = user_id);

drop policy if exists "friends delete own" on public.friends;
create policy "friends delete own"
  on public.friends for delete
  using (auth.uid() = user_id);

-- The "accept request" flow needs to insert the MIRROR row on the
-- sender's side as well (B's circle gets a row pointing at A). That's
-- a row owned by user_id = sender, written by the recipient. Without
-- this policy the second upsert in acceptFriendRequest fails.
drop policy if exists "friends mirror insert" on public.friends;
create policy "friends mirror insert"
  on public.friends for insert
  with check (
    -- The caller is accepting a request from `user_id`. They prove
    -- it by their username matching the friend_username being inserted.
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.username = friend_username
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Indexes — same hot paths as sql/05
-- ---------------------------------------------------------------------------
create index if not exists friends_user_added_idx
  on public.friends (user_id, added_at desc);

create index if not exists friends_friend_username_idx
  on public.friends (friend_username);

-- friend_requests: incoming list query is by to_username + status.
create index if not exists friend_requests_to_status_idx
  on public.friend_requests (to_username, status, created_at desc);

-- Outgoing list query is by from_user_id.
create index if not exists friend_requests_from_idx
  on public.friend_requests (from_user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Sanity check — confirm both tables exist with the expected shape.
-- ---------------------------------------------------------------------------
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('friends', 'friend_requests')
order by table_name, ordinal_position;
