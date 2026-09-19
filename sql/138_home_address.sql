-- 138_home_address.sql
-- ============================================================================
-- Home, as a place ORBII knows about.
--
-- WHAT IT IS FOR, stated here because the purpose is the thing that makes
-- collecting this lawful and the thing the onboarding screen has to say out
-- loud. DPDP Act section 6 requires consent tied to a specified purpose, and
-- "we may want it later" is not one.
--
--   1. "Did she get home." A Safe Journey with no destination can only report
--      that she stopped moving. With home known, it can say she arrived.
--   2. The address a responder is actually given. A circle member reading an
--      SOS gets coordinates. Coordinates are not what you read out to a
--      driver, a guard or a control room.
--   3. The seed for a home safe zone, so the first geofence is not a blank map.
--
-- THIS IS THE MOST SENSITIVE ROW IN THE DATABASE. A home address belonging to
-- a woman who installed a personal safety app is worse to leak than her phone
-- number, her location history, or her name. Everything below follows from
-- that:
--
--   - NOBODY BUT THE OWNER CAN READ IT. Not her circle, not an admin, not
--     another signed-in user. There is exactly one SELECT policy and it is
--     `auth.uid() = user_id`. Circle members get the address only if she sends
--     it, through the app, during an event. It is never readable by being in
--     her circle.
--   - It is optional. The onboarding step can be skipped and the app works.
--   - It is deletable. `delete_my_home_address()` exists so removal is one
--     call and not a support request.
--   - No geocoding on write. We store the text she typed. Turning it into a
--     coordinate here would create a second, quieter copy of where she lives.
--
-- Idempotent. No transaction control, nothing here can raise.
-- ============================================================================

create table if not exists public.home_address (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  -- Indian addresses, in the shape people actually write them. Free text, one
  -- line per line, because a structured address schema built for one country
  -- fails on the next street over.
  line1       text not null,
  line2       text,
  landmark    text,
  city        text not null,
  state       text,
  pincode     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.home_address is
  'One home address per user. Readable ONLY by the user it belongs to. Used for arrival detection, the address given to responders during an SOS, and seeding a home safe zone.';

alter table public.home_address enable row level security;


-- ---------------------------------------------------------------------------
-- POLICIES. One per command, all of them owner-only.
-- ---------------------------------------------------------------------------
drop policy if exists "home_address owner read"   on public.home_address;
drop policy if exists "home_address owner insert" on public.home_address;
drop policy if exists "home_address owner update" on public.home_address;
drop policy if exists "home_address owner delete" on public.home_address;

create policy "home_address owner read"
  on public.home_address for select to authenticated
  using (auth.uid() = user_id);

create policy "home_address owner insert"
  on public.home_address for insert to authenticated
  with check (auth.uid() = user_id);

create policy "home_address owner update"
  on public.home_address for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "home_address owner delete"
  on public.home_address for delete to authenticated
  using (auth.uid() = user_id);


-- ---------------------------------------------------------------------------
-- GRANTS.
--
-- SELECT is granted at TABLE level here, not per column, and that is safe
-- precisely because the SELECT policy above is owner-only: the grant lets
-- PostgREST run its statement, and the policy decides which rows exist.
--
-- The grant matters for a reason learned the hard way on 19 September 2026:
-- PostgREST sends an upsert as INSERT ... ON CONFLICT DO UPDATE, which has to
-- read the conflicting row, so Postgres requires SELECT on every column in the
-- SET list. A column-level grant that misses one column makes the whole
-- statement fail with "permission denied for table", before any write happens,
-- and the app swallows it. See sql/137.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on table public.home_address to authenticated;
revoke all on table public.home_address from anon;


-- ---------------------------------------------------------------------------
-- updated_at, so "when did she last change this" is answerable.
-- ---------------------------------------------------------------------------
create or replace function public.touch_home_address()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists home_address_touch on public.home_address;
create trigger home_address_touch
  before update on public.home_address
  for each row execute function public.touch_home_address();


-- ---------------------------------------------------------------------------
-- ONE-CALL DELETION.
--
-- Removing your home address should not need a support ticket, and it should
-- not need the app to construct a DELETE. SECURITY DEFINER so it works the
-- same however the policies later change, and scoped to auth.uid() so it can
-- only ever delete the caller's own row.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_home_address()
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  delete from public.home_address where user_id = auth.uid();
  return true;
end $$;

revoke all on function public.delete_my_home_address() from public, anon;
grant execute on function public.delete_my_home_address() to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'the table exists' as check,
       (to_regclass('public.home_address') is not null)::text as result
union all
select 'row level security is on (must be true)',
       (select relrowsecurity::text from pg_class where oid = 'public.home_address'::regclass)
union all
select 'policies on it (must be 4)',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'home_address')
union all
select 'every policy is owner-scoped (must be 4)',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'home_address'
          and coalesce(qual, with_check) like '%auth.uid()%')
union all
select 'anon cannot read it (must be false)',
       has_table_privilege('anon', 'public.home_address', 'SELECT')::text
union all
select 'authenticated can run the upsert (must be true)',
       has_table_privilege('authenticated', 'public.home_address', 'SELECT')::text
union all
select 'deletion is one call (must be true)',
       (to_regprocedure('public.delete_my_home_address()') is not null)::text;
