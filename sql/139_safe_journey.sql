-- 139_safe_journey.sql
-- ============================================================================
-- THE SAFETY LOOP REACHES THE CIRCLE.
--
-- Today, when she starts a Safe Journey, her phone knows and her circle knows
-- nothing. SafeJourney lives only in Redux (appSlice.ts), carries ONE trusted
-- contact rather than circle recipients, and `shared_trips` has existed since
-- sql/09 with nothing ever writing to it: listSharedTrips is its only
-- reference in the whole app.
--
-- So the product's core loop breaks at step two:
--
--     "I am going somewhere"
--  -> "my trusted people know"          <- this does not happen
--  -> "ORBII watches for exceptions"
--  -> "I arrive safely"
--  -> "sharing ends"
--
-- This migration is step two. It does not invent a journey system; the table
-- was written a year ago. It gives it states, an ETA, a way to start and end
-- one safely, and a sweep that notices when an arrival does not happen.
--
-- ============================================================================
-- THREE THINGS THIS DELIBERATELY DOES NOT DO
-- ============================================================================
--
-- 1. NO POSITION ON THE TRIP ROW. No lat, no lng, no battery, no last_update.
--    circle_locations already carries all of that WITH server-side precision
--    snapping (sql/123), server-computed freshness and `unreachable` (sql/118).
--    Copying position onto the journey row would create a second source of
--    truth with its own freshness clock, and a journey pin disagreeing with a
--    member pin is precisely the bug sql/118 exists to prevent.
--
--    A journey therefore ARMS bounded circle sharing for its duration. One
--    position pipeline, one snap, one freshness. The trip row holds journey
--    facts only: where she is going, when she should arrive, what kind of
--    journey it is, and what state it is in.
--
-- 2. NO SECOND STATE COLUMN. `status` is widened rather than joined by a
--    parallel `journey_state`. Two columns meaning the same thing is the same
--    duplication as point 1, one level down.
--
-- 3. NO EDGE FUNCTION FOR THE SWEEP. This project already runs
--    escalate_stale_geofence_leaves, circle_presence_sweep, push_outbox_alarm
--    and rescue_recover on pg_cron every minute. A scheduled Edge Function
--    would be a second mechanism with cold starts and its own failure mode.
--
-- ============================================================================
-- OVERDUE IS A SIGNAL, NOT AN EMERGENCY
-- ============================================================================
--
-- A missed ETA means a missed ETA. It does not mean she is in danger, and the
-- notification says only what happened. "Her journey is 12 minutes overdue",
-- never "she may be in danger". A system that cries danger at a slow bus
-- teaches people to ignore it, and then it is worse than nothing on the night
-- it matters.
--
-- Idempotent. No transaction control, nothing here can raise.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. JOURNEY FACTS
-- ---------------------------------------------------------------------------
alter table public.shared_trips
  add column if not exists eta_at            timestamptz,
  add column if not exists kind              text not null default 'custom',
  add column if not exists destination_label text,
  -- Set when the overdue sweep has already told the circle, so a journey that
  -- stays overdue for an hour produces one notification and not sixty.
  add column if not exists overdue_notified_at timestamptz;

comment on column public.shared_trips.eta_at is
  'When she expected to arrive. Null means an open-ended journey, which is never marked overdue.';
comment on column public.shared_trips.kind is
  'walk | cab | commute | travel | custom. Changes wording and default duration, nothing else.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shared_trips'::regclass and conname = 'shared_trips_kind_check'
  ) then
    alter table public.shared_trips add constraint shared_trips_kind_check
      check (kind in ('walk', 'cab', 'commute', 'travel', 'custom'));
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 2. THE STATES
--
-- Widening the existing check rather than adding a column. `expired` stays for
-- rows already written under the old constraint.
--
--   active    on the way
--   overdue   past ETA plus grace, and nobody has said anything
--   attention needs a look for a reason other than time. Reserved; nothing
--             sets it yet, and it is listed here so the enum does not have to
--             change again when something does.
--   arrived   she said she got there
--   cancelled she called it off
-- ---------------------------------------------------------------------------
alter table public.shared_trips drop constraint if exists shared_trips_status_check;
alter table public.shared_trips add constraint shared_trips_status_check
  check (status in ('active', 'overdue', 'attention', 'arrived', 'expired', 'cancelled'));


-- ---------------------------------------------------------------------------
-- 3. THE INDEX THE SWEEP AND THE MAP BOTH USE
-- ---------------------------------------------------------------------------
create index if not exists shared_trips_live_idx
  on public.shared_trips (circle_id, status)
  where status in ('active', 'overdue', 'attention');

create index if not exists shared_trips_due_idx
  on public.shared_trips (eta_at)
  where status = 'active' and eta_at is not null;


-- ---------------------------------------------------------------------------
-- 4. READ IS MEMBER-SCOPED AND REVOCATION-AWARE
--
-- is_circle_member already filters deleted_at, so a removed member loses trips
-- today. The explicit revocation clause is defence in depth for the case where
-- a revoked person still holds a live membership row, and it makes the journey
-- read the fifth place revocation is enforced, alongside join, the SOS
-- fan-out, the location read and the feed read.
-- ---------------------------------------------------------------------------
drop policy if exists "trips read members" on public.shared_trips;
create policy "trips read members"
  on public.shared_trips for select
  to authenticated
  using (
    public.is_circle_member(circle_id)
    and not exists (
      select 1 from public.circle_revocations rv
      where rv.circle_id = shared_trips.circle_id
        and rv.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- 5. START
--
-- SECURITY DEFINER so membership is checked here rather than trusted from the
-- client, and so one call can close a previous journey and open a new one
-- atomically.
--
-- ONE LIVE JOURNEY PER PERSON PER CIRCLE. Starting a second closes the first
-- as `cancelled`. Two active journeys for one person is not a state a circle
-- can act on: it would show two destinations and two ETAs for somebody who is
-- in one place going to one of them.
-- ---------------------------------------------------------------------------
create or replace function public.start_safe_journey(
  p_circle       uuid,
  p_label        text,
  p_kind         text default 'custom',
  p_destination  jsonb default null,
  p_dest_label   text default null,
  p_eta_at       timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  if not public.is_circle_member(p_circle) then
    raise exception 'you are not in that circle';
  end if;

  if exists (
    select 1 from circle_revocations
    where circle_id = p_circle and user_id = auth.uid()
  ) then
    raise exception 'you cannot start a journey in that circle';
  end if;

  if coalesce(btrim(p_label), '') = '' then
    raise exception 'a journey needs a label';
  end if;

  -- An ETA in the past is somebody's clock being wrong, and accepting it would
  -- mark the journey overdue the moment it began.
  if p_eta_at is not null and p_eta_at <= now() then
    raise exception 'that arrival time has already passed';
  end if;

  update shared_trips
     set status = 'cancelled', end_at = now()
   where owner_id = auth.uid()
     and circle_id = p_circle
     and status in ('active', 'overdue', 'attention');

  insert into shared_trips
    (circle_id, owner_id, label, kind, destination, destination_label,
     start_at, eta_at, status)
  values
    (p_circle, auth.uid(), btrim(p_label), coalesce(p_kind, 'custom'),
     p_destination, nullif(btrim(coalesce(p_dest_label, '')), ''),
     now(), p_eta_at, 'active')
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.start_safe_journey(uuid, text, text, jsonb, text, timestamptz)
  from public, anon;
grant execute on function public.start_safe_journey(uuid, text, text, jsonb, text, timestamptz)
  to authenticated;


-- ---------------------------------------------------------------------------
-- 6. END IT
--
-- Two verbs, because "I got there" and "I changed my mind" are different
-- things to the people watching. Both are hers alone to say: a circle member
-- cannot mark somebody else arrived.
-- ---------------------------------------------------------------------------
create or replace function public.end_safe_journey(p_trip uuid, p_arrived boolean)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  update shared_trips
     set status = case when p_arrived then 'arrived' else 'cancelled' end,
         end_at = now()
   where id = p_trip
     and owner_id = auth.uid()
     and status in ('active', 'overdue', 'attention');

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

revoke all on function public.end_safe_journey(uuid, boolean) from public, anon;
grant execute on function public.end_safe_journey(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------------
-- 7. THE SWEEP
--
-- GRACE IS TEN MINUTES, and it is a named constant rather than a number buried
-- in a query. An Indian commute that says 25 minutes takes 25 minutes on a
-- good day. Marking somebody overdue at minute 26 would fire on almost every
-- journey, and a signal that fires every time is noise. Ten is a starting
-- point, not a measured figure, and it should move once there is real data on
-- how late a normal journey actually runs.
--
-- The sweep only flips state and records that it did. It sends nothing itself:
-- push fan-out already has an owner in this system, and a second sender would
-- be a second thing to keep honest.
-- ---------------------------------------------------------------------------
create or replace function public.journey_overdue_grace()
returns interval language sql immutable as $$ select interval '10 minutes' $$;

create or replace function public.mark_overdue_journeys()
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_rows int;
begin
  update shared_trips
     set status = 'overdue',
         overdue_notified_at = now()
   where status = 'active'
     and eta_at is not null
     and now() > eta_at + public.journey_overdue_grace();

  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

revoke all on function public.mark_overdue_journeys() from public, anon, authenticated;
grant execute on function public.mark_overdue_journeys() to service_role;

-- Same cadence and same mechanism as the sweeps already running.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('orbii-journey-overdue')
      where exists (select 1 from cron.job where jobname = 'orbii-journey-overdue');
    perform cron.schedule(
      'orbii-journey-overdue',
      '* * * * *',
      $cron$ select public.mark_overdue_journeys(); $cron$
    );
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'eta_at exists' as check,
       (exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='shared_trips'
                  and column_name='eta_at'))::text as result
union all
select 'status accepts overdue',
       (pg_get_constraintdef(
          (select oid from pg_constraint where conname='shared_trips_status_check')
        ) ~ 'overdue')::text
union all
select 'no position columns were added (must be true)',
       (not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='shared_trips'
                      and column_name in ('lat_snapped','lng_snapped','battery')))::text
union all
select 'read policy checks revocation',
       (select (qual ~ 'circle_revocations')::text from pg_policies
        where schemaname='public' and tablename='shared_trips' and cmd='SELECT')
union all
select 'start_safe_journey exists',
       (to_regprocedure('public.start_safe_journey(uuid,text,text,jsonb,text,timestamptz)') is not null)::text
union all
select 'end_safe_journey exists',
       (to_regprocedure('public.end_safe_journey(uuid,boolean)') is not null)::text
union all
select 'anon cannot start a journey (must be false)',
       has_function_privilege('anon',
         'public.start_safe_journey(uuid,text,text,jsonb,text,timestamptz)', 'execute')::text
union all
select 'the overdue sweep is scheduled',
       (exists (select 1 from cron.job where jobname='orbii-journey-overdue'))::text
union all
select 'grace is ten minutes',
       public.journey_overdue_grace()::text;
