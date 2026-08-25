-- 84_circles_hardening.sql
-- ============================================================================
-- Circles hardening: soft deletes, loop prevention, race safety, rate limits.
--
-- THIS IS A MIGRATION, NOT A FRESH SCHEMA. circles, circle_members and
-- circle_invites already exist in production (sql/09, sql/10, sql/14) and
-- already carry the things a clean-slate design would add:
--
--   * unique (circle_id, user_id)              -- duplicate members impossible
--   * role check ('owner','admin','member')    -- hierarchy already modelled
--   * on delete cascade to auth.users          -- no dangling rows
--
-- So this file adds only what is genuinely missing, and nothing here drops or
-- recreates a live table. Idempotent; safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SOFT DELETES
-- ---------------------------------------------------------------------------
no emojies --
-- A hard DELETE on circle_members destroys the answer to "was B in A's circle
-- when this SOS fired". That question matters twice: for an incident review,
-- and for a helper accused of turning up somewhere they had no business being.
-- The row is evidence, so removal has to be reversible and dated.
--
-- circles themselves already cascade from auth.users and are owned by exactly
-- one person, so a deleted circle has no independent evidentiary value.
alter table circle_members
  add column if not exists deleted_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null;

-- The original unique(circle_id, user_id) would block re-adding somebody who
-- was removed, because the tombstone still occupies the pair. Replace it with a
-- PARTIAL unique index over live rows only: one active membership per person
-- per circle, unlimited historical ones.
alter table circle_members drop constraint if exists circle_members_circle_id_user_id_key;
drop index if exists circle_members_active_uq;
create unique index circle_members_active_uq
  on circle_members (circle_id, user_id)
  where deleted_at is null;

create index if not exists circle_members_live_idx
  on circle_members (user_id) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. FAN-OUT WITH LOOP PREVENTION
-- ---------------------------------------------------------------------------
-- The "A has B, B has A" cascade cannot happen in this schema, and it is worth
-- being precise about why rather than adding a guard that does nothing.
--
-- Circles are not a graph that is walked. An SOS resolves ONE level: the
-- victim's circles, their live members, done. Nobody's alert triggers anybody
-- else's alert, so there is no recursion to terminate and mutual membership is
-- simply two rows.
--
-- The real risk is not a loop, it is a DUPLICATE: one person in three of your
-- circles receiving three pushes for the same emergency, which reads as a
-- malfunction at the exact moment you need to look competent. That is what the
-- DISTINCT below is for.
create or replace function public.sos_circle_recipients(p_sos uuid)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  with victim as (
    select e.user_id as vid from sos_events e where e.id = p_sos
  )
  select distinct m.user_id
  from circle_members m
  join circles c on c.id = m.circle_id
  join victim v on true
  where c.owner_id = v.vid          -- circles the victim owns
    and m.deleted_at is null        -- live memberships only
    and m.user_id <> v.vid          -- never notify the victim about herself
$$;

revoke all on function public.sos_circle_recipients(uuid) from public, anon;
grant execute on function public.sos_circle_recipients(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. REMOVAL THAT ACTUALLY REVOKES ACCESS
-- ---------------------------------------------------------------------------
-- Removing somebody must cut their live location feed in the same statement
-- that removes them, not on their next app launch.
--
-- Supabase Realtime authorises a subscription at CONNECT time. A socket opened
-- while B was a member keeps streaming after the row is gone, because nothing
-- re-evaluates it. So the tombstone alone is not enough: we bump a revocation
-- counter that the realtime authoriser (sql/39) checks per message, which
-- turns a stale socket into a rejected one on its very next frame.
create table if not exists circle_revocations (
  circle_id  uuid not null references circles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

alter table circle_revocations enable row level security;
-- No client policy at all. Only SECURITY DEFINER functions and the service role
-- touch this; a client that could read it would learn who was removed from
-- circles it does not belong to.

create or replace function public.circle_remove_member(
  p_circle uuid,
  p_user   uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  my_role   text;
  tgt_role  text;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- Caller must be a live owner or admin of THIS circle.
  select role into my_role
  from circle_members
  where circle_id = p_circle and user_id = uid and deleted_at is null;

  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select role into tgt_role
  from circle_members
  where circle_id = p_circle and user_id = p_user and deleted_at is null;

  if tgt_role is null then
    return jsonb_build_object('ok', false, 'reason', 'not_a_member');
  end if;

  -- An owner cannot be removed by anybody, including themselves. Deleting the
  -- circle is the way out; leaving it ownerless would strand every other member
  -- with a circle nobody can administer.
  if tgt_role = 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'cannot_remove_owner');
  end if;

  -- An admin may remove members but not other admins. Only the owner outranks
  -- an admin, which stops two admins from removing each other in a race.
  if tgt_role = 'admin' and my_role <> 'owner' then
    return jsonb_build_object('ok', false, 'reason', 'admin_requires_owner');
  end if;

  update circle_members
     set deleted_at = now(), removed_by = uid
   where circle_id = p_circle and user_id = p_user and deleted_at is null;

  -- Cut the live feed now, not at next launch.
  insert into circle_revocations (circle_id, user_id, revoked_at)
  values (p_circle, p_user, now())
  on conflict (circle_id, user_id) do update set revoked_at = now();

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.circle_remove_member(uuid, uuid) from public, anon;
grant execute on function public.circle_remove_member(uuid, uuid) to authenticated;

-- Re-adding somebody must clear the tombstone AND the revocation, or their
-- socket stays rejected forever and the bug looks like "realtime is broken".
create or replace function public.circle_add_member(
  p_circle uuid,
  p_user   uuid,
  p_role   text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  my_role text;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  select role into my_role
  from circle_members
  where circle_id = p_circle and user_id = uid and deleted_at is null;

  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  -- Only an owner may mint another admin.
  if p_role = 'admin' and my_role <> 'owner' then
    raise exception 'only the owner can add an admin' using errcode = '42501';
  end if;

  -- REVIVE FIRST, THEN INSERT. Order matters here and getting it backwards is
  -- a live bug: the partial unique index ignores tombstoned rows, so an INSERT
  -- does NOT conflict with one. Insert-then-revive therefore creates a second
  -- row and then un-deletes the first, producing two live memberships and a
  -- unique violation on the way out.
  update circle_members
     set deleted_at = null, removed_by = null, role = p_role
   where circle_id = p_circle
     and user_id = p_user
     and deleted_at is not null;

  if not found then
    insert into circle_members (circle_id, user_id, role)
    values (p_circle, p_user, p_role)
    on conflict (circle_id, user_id) where deleted_at is null
      do nothing;
  end if;

  delete from circle_revocations where circle_id = p_circle and user_id = p_user;

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.circle_add_member(uuid, uuid, text) from public, anon;
grant execute on function public.circle_add_member(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. ONE ACTIVE SOS PER PERSON
-- ---------------------------------------------------------------------------
-- Two members of one circle triggering simultaneously is fine and must both go
-- through; they are two emergencies. The dangerous race is ONE person firing
-- twice in the same millisecond from a retry, a double tap, or the voice
-- trigger and the button landing together.
--
-- A partial unique index makes the second one impossible at the storage layer,
-- which is the only place a race can actually be won.
-- FIRST RUN FAILED HERE, AND THAT FAILURE WAS THE POINT.
--
--   ERROR: could not create unique index "sos_events_one_active_uq"
--   DETAIL: Key (user_id)=(8ee693c9-...) is duplicated.
--
-- The constraint could not be added because the thing it prevents had already
-- happened: at least one account is carrying more than one SOS in 'active'.
-- That is not a migration problem, it is a live data problem, and it means the
-- escalation engine may still be ticking on abandoned events, dispatching
-- helpers to emergencies that ended days ago.
--
-- So the duplicates are closed before the index goes on, keeping the NEWEST
-- active event per user and cancelling the older ones. Newest, because if any
-- of them is a real emergency in progress it is the most recent one; closing
-- that and keeping a stale one would be the one genuinely dangerous outcome.
--
-- CANCELLED, not RESOLVED. 'resolved' means somebody reached her and it ended.
-- These were abandoned, and recording an abandonment as a resolution would put
-- a lie in the incident history, which is the record we would rely on if an
-- SOS were ever disputed.
do $$
declare
  n_users int;
  n_rows  int;
begin
  select count(*), coalesce(sum(c) - count(*), 0)
    into n_users, n_rows
  from (
    select user_id, count(*) as c
    from sos_events
    where status = 'active'
    group by user_id
    having count(*) > 1
  ) d;

  if n_users > 0 then
    raise notice E'
  % account(s) carry more than one active SOS; closing % stale row(s).', n_users, n_rows;

    with ranked as (
      select id,
             row_number() over (partition by user_id order by created_at desc, id desc) as rn
      from sos_events
      where status = 'active'
    )
    update sos_events e
       set status      = 'cancelled',
           resolved_at = coalesce(e.resolved_at, now()),
           updated_at  = now()
      from ranked r
     where e.id = r.id
       and r.rn > 1;
  else
    raise notice E'
  No duplicate active SOS events. Nothing to clean.';
  end if;
end $$;

drop index if exists sos_events_one_active_uq;
create unique index sos_events_one_active_uq
  on sos_events (user_id)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 5. RATE LIMIT ON TRIGGERS
-- ---------------------------------------------------------------------------
-- Uses rate_ok() from sql/79, the Postgres token bucket. There is no Redis in
-- this stack and adding one for this would be a server to run, pay for and
-- monitor in order to slow down a loop that Postgres can already stop.
--
-- The limit is deliberately loose. A woman who fires three SOS in a minute
-- because she is terrified and unsure it worked is not abusing anything, and
-- throttling her is a far worse failure than absorbing a few extra rows.
create or replace function public.sos_trigger_allowed()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- 5 in 60s absorbs panic and retries; a client loop firing 50/sec is stopped
  -- at the sixth.
  if not public.rate_ok('sos:' || uid::text, 5, 60) then
    return jsonb_build_object('allowed', false, 'reason', 'rate_limited');
  end if;

  -- Already have one running: the client should resume it, not open a second.
  if exists (select 1 from sos_events where user_id = uid and status = 'active') then
    return jsonb_build_object('allowed', false, 'reason', 'already_active');
  end if;

  return jsonb_build_object('allowed', true);
end $$;

revoke all on function public.sos_trigger_allowed() from public, anon;
grant execute on function public.sos_trigger_allowed() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS ON MEMBERSHIP -> MOVED TO sql/85
-- ---------------------------------------------------------------------------
-- This section originally added a policy on circle_members whose USING clause
-- ran `exists (select 1 from circle_members ...)`. A policy on a table that
-- reads that same table recurses, and Postgres rejects every read with:
--
--   42P17: infinite recursion detected in policy for relation "circle_members"
--
-- which took the whole Circles feature down. This project had already solved
-- that twice, in sql/10 and sql/61, with the SECURITY DEFINER helper
-- is_circle_member(); I did not use it and reintroduced the bug those files
-- exist to prevent.
--
-- The policy now lives in sql/85_circles_rls_recursion_fix.sql, with the
-- soft-delete rule pushed into the helper where it belongs. Deliberately left
-- as a comment rather than deleted, so the next person reading this file in
-- order does not wonder why section 6 is missing.

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  select string_agg(n || ': ' || v, e'\n') into msg from (
    select 'circle_members.deleted_at' as n,
           case when exists (select 1 from information_schema.columns
                             where table_name='circle_members' and column_name='deleted_at')
                then 'ok' else 'MISSING' end as v
    union all
    select 'partial unique on live members',
           case when exists (select 1 from pg_indexes where indexname='circle_members_active_uq')
                then 'ok' else 'MISSING' end
    union all
    select 'one active sos per user',
           case when exists (select 1 from pg_indexes where indexname='sos_events_one_active_uq')
                then 'ok' else 'MISSING' end
    union all
    select 'revocation table',
           case when to_regclass('public.circle_revocations') is not null
                then 'ok' else 'MISSING' end
  ) c;
  raise notice E'\n%', msg;
end $$;
