-- ORBII circles migration. Paste into the Supabase SQL editor and run once.
-- Idempotent: safe to re-run.
--
-- Adds:
--   circles         : a named group a user belongs to (Family, College, …)
--   circle_members  : membership + role
--   circle_invites  : pending invites by username or phone
--   circle_events   : per-circle activity stream (joins, alerts, trips)
--   shared_trips    : a journey shared with the circle
--
-- Each user can own / belong to multiple circles. There is no hard cap at the
-- DB layer — the UI surfaces a soft cap so the app stays calm.
--
-- RLS is enforced strictly: a user can only read circles they are a member of,
-- and only insert events / invites for circles they belong to.

-- ---------------------------------------------------------------------------
-- 1. CIRCLES
-- ---------------------------------------------------------------------------
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- kind is a soft taxonomy for icons + default colors. Free-form so we can
  -- add categories without a migration.
  kind text not null default 'general'
    check (kind in ('family','friends','trip','college','women','emergency','general')),
  color text not null default '#57C691',
  emoji text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists circles_owner_idx on circles (owner_id);

alter table circles enable row level security;

-- ---------------------------------------------------------------------------
-- 2. CIRCLE_MEMBERS
-- ---------------------------------------------------------------------------
create table if not exists circle_members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
);

create index if not exists circle_members_user_idx on circle_members (user_id);
create index if not exists circle_members_circle_idx on circle_members (circle_id);

alter table circle_members enable row level security;

-- ---------------------------------------------------------------------------
-- 3. CIRCLE_INVITES
-- ---------------------------------------------------------------------------
create table if not exists circle_invites (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  -- one of these two will be set; the other null. Phone is E.164.
  invitee_username text,
  invitee_phone text,
  -- Short share token for deep links: orbii://join/<token>
  token text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,10),
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','revoked','expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (invitee_username is not null or invitee_phone is not null)
);

create index if not exists circle_invites_circle_idx on circle_invites (circle_id);
create index if not exists circle_invites_token_idx on circle_invites (token);
create index if not exists circle_invites_username_idx on circle_invites (lower(invitee_username));

alter table circle_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 4. CIRCLE_EVENTS — activity stream
-- ---------------------------------------------------------------------------
create table if not exists circle_events (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  -- kind is open-ended so new event types don't need a migration.
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists circle_events_circle_time_idx
  on circle_events (circle_id, created_at desc);

alter table circle_events enable row level security;

-- ---------------------------------------------------------------------------
-- 5. SHARED_TRIPS
-- ---------------------------------------------------------------------------
create table if not exists shared_trips (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references circles(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  destination jsonb,
  start_at timestamptz not null default now(),
  end_at timestamptz,
  status text not null default 'active'
    check (status in ('active','arrived','expired','cancelled')),
  created_at timestamptz not null default now()
);

create index if not exists shared_trips_circle_time_idx
  on shared_trips (circle_id, start_at desc);

alter table shared_trips enable row level security;

-- ---------------------------------------------------------------------------
-- 6. RLS POLICIES
-- ---------------------------------------------------------------------------

-- Helper: is the current user a member of this circle?
create or replace function is_circle_member(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from circle_members
    where circle_id = c and user_id = auth.uid()
  );
$$;

-- circles
drop policy if exists "circles read members" on circles;
create policy "circles read members"
  on circles for select
  using (is_circle_member(id));

drop policy if exists "circles insert self" on circles;
create policy "circles insert self"
  on circles for insert
  with check (auth.uid() = owner_id);

drop policy if exists "circles owner update" on circles;
create policy "circles owner update"
  on circles for update
  using (auth.uid() = owner_id);

drop policy if exists "circles owner delete" on circles;
create policy "circles owner delete"
  on circles for delete
  using (auth.uid() = owner_id);

-- circle_members
drop policy if exists "members read same circle" on circle_members;
create policy "members read same circle"
  on circle_members for select
  using (is_circle_member(circle_id));

drop policy if exists "members insert self or owner" on circle_members;
create policy "members insert self or owner"
  on circle_members for insert
  with check (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

drop policy if exists "members leave self" on circle_members;
create policy "members leave self"
  on circle_members for delete
  using (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- circle_invites
drop policy if exists "invites read by inviter or invitee" on circle_invites;
create policy "invites read by inviter or invitee"
  on circle_invites for select
  using (
    auth.uid() = inviter_id
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and lower(up.username) = lower(coalesce(invitee_username, ''))
    )
  );

drop policy if exists "invites insert by member" on circle_invites;
create policy "invites insert by member"
  on circle_invites for insert
  with check (auth.uid() = inviter_id and is_circle_member(circle_id));

drop policy if exists "invites update by inviter or invitee" on circle_invites;
create policy "invites update by inviter or invitee"
  on circle_invites for update
  using (
    auth.uid() = inviter_id
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and lower(up.username) = lower(coalesce(invitee_username, ''))
    )
  );

-- circle_events
drop policy if exists "events read members" on circle_events;
create policy "events read members"
  on circle_events for select
  using (is_circle_member(circle_id));

drop policy if exists "events insert members" on circle_events;
create policy "events insert members"
  on circle_events for insert
  with check (is_circle_member(circle_id) and auth.uid() = actor_id);

-- shared_trips
drop policy if exists "trips read members" on shared_trips;
create policy "trips read members"
  on shared_trips for select
  using (is_circle_member(circle_id));

drop policy if exists "trips insert by member" on shared_trips;
create policy "trips insert by member"
  on shared_trips for insert
  with check (auth.uid() = owner_id and is_circle_member(circle_id));

drop policy if exists "trips update owner" on shared_trips;
create policy "trips update owner"
  on shared_trips for update
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 7. TRIGGERS
-- ---------------------------------------------------------------------------

-- When a circle is inserted, auto-add the owner as a member with role=owner.
create or replace function on_circle_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into circle_members (circle_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists circles_after_insert on circles;
create trigger circles_after_insert
  after insert on circles
  for each row execute function on_circle_created();

-- Keep updated_at fresh on circles updates.
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists circles_touch_updated_at on circles;
create trigger circles_touch_updated_at
  before update on circles
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 8. REALTIME
-- ---------------------------------------------------------------------------
-- Make circle_events + shared_trips stream over realtime so the UI updates
-- without polling.
alter publication supabase_realtime add table circle_events;
alter publication supabase_realtime add table shared_trips;
alter publication supabase_realtime add table circle_members;
