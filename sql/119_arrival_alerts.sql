-- 119_arrival_alerts.sql
-- ============================================================================
-- Arrival alerts. Half of this feature has existed since sql/41 and the other
-- half never did.
--
-- WHAT WAS ACTUALLY BUILT. geofence_events records both kinds, the OS task
-- handles both kinds, and then the handler says "ENTER is history-only" and
-- stops. notify-geofence agrees with it: its second line is
-- `if (kind !== 'exit') return { sent: 0, reason: 'not an exit' }`. So a
-- crossing INTO a place is written to a table nobody is notified about.
--
-- That is the wrong half to have. "She left college at 2pm when she should be
-- inside until 5" is the alarm, and it works. "She got to college" is the one
-- that gets read every single day, and it does not exist.
--
-- WHY THIS IS NOT `if (kind === 'enter') send()`. Three ways that fires when
-- nothing happened:
--
--   1. REGISTRATION. Android delivers an initial ENTER for any region the
--      phone is already inside when monitoring starts. syncZoneMonitoring runs
--      on every app launch, so the naive version pushes "she arrived home" to
--      her whole circle every time she opens the app at home.
--
--   2. FLAPPING. A GPS fix wanders tens of metres. Sit near the edge of a
--      300m zone and the OS will deliver enter, exit, enter, exit for a phone
--      on a table.
--
--   3. THE SHOP NEXT DOOR. Step out for four minutes and come back, and a
--      circle gets an arrival notification for a journey nobody took.
--
-- ONE RULE HANDLES ALL THREE: an arrival only counts if the previous event for
-- this person and this place was a DEPARTURE, and that departure was at least
-- ten minutes ago. Registration has no previous event, so it is silent.
-- Flapping fails the ten minutes. The shop fails it too. A real journey passes.
--
-- The decision is made here rather than in the app because the app is a
-- background OS task with no memory between invocations, which is precisely
-- the wrong place to hold "what happened last time".
--
-- Idempotent. Run after sql/118.
-- ============================================================================

-- Per place, because the answer differs by place. Arrivals at home are
-- reassurance; arrivals at a friend's house may be none of anyone's business.
-- Defaults keep the existing behaviour for every zone already created: leaving
-- alerts, which is what those zones were set up for.
alter table geofences add column if not exists notify_arrival   boolean not null default true;
alter table geofences add column if not exists notify_departure boolean not null default true;

-- The gap a real journey has to clear. Ten minutes is long enough to rule out
-- boundary wander and a step outside, short enough that a genuine trip to
-- college always passes.
create or replace function public.orbii_geofence_settle_minutes()
returns int language sql immutable as $$ select 10 $$;

revoke all on function public.orbii_geofence_settle_minutes() from public, anon;
grant execute on function public.orbii_geofence_settle_minutes() to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- SHOULD THIS CROSSING TELL ANYONE
-- ---------------------------------------------------------------------------
-- Returns the kind to alert on, or null for silence. The app inserts the event
-- first (history is unconditional, and always was) and then asks this.
--
-- Deliberately returns null rather than raising on every "no". A background
-- geofence task that throws is a background geofence task Android eventually
-- stops delivering to, and losing the departure alarm to protect the arrival
-- alert would be a bad trade.
create or replace function public.geofence_event_should_alert(p_event uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  ev  record;
  g   record;
  prev record;
begin
  select e.id, e.geofence_id, e.member_id, e.kind, e.created_at
    into ev
  from geofence_events e
  where e.id = p_event;
  if not found then return null; end if;

  -- Only the person the event is about may ask about it. Without this, the
  -- function is a way to probe whether any given event id exists and what
  -- place it belongs to.
  if ev.member_id <> auth.uid() then return null; end if;

  select gf.label, gf.active_from, gf.active_to, gf.notify_arrival, gf.notify_departure
    into g
  from geofences gf
  where gf.id = ev.geofence_id and gf.active;
  if not found then return null; end if;

  -- The event immediately before this one, for this person and this place.
  select e2.kind, e2.created_at
    into prev
  from geofence_events e2
  where e2.geofence_id = ev.geofence_id
    and e2.member_id = ev.member_id
    and e2.id <> ev.id
    and e2.created_at <= ev.created_at
  order by e2.created_at desc
  limit 1;

  if ev.kind = 'enter' then
    if not g.notify_arrival then return null; end if;
    -- No history means monitoring just started somewhere she already was.
    -- She did not arrive; the app did.
    if not found then return null; end if;
    -- Two enters in a row is the OS repeating itself, not a second arrival.
    if prev.kind <> 'exit' then return null; end if;
    -- And the departure has to have been long enough ago to have been real.
    if prev.created_at > ev.created_at - make_interval(
         mins => public.orbii_geofence_settle_minutes()) then
      return null;
    end if;
    -- Arrival is not filtered by the zone's active hours, and that is on
    -- purpose. The hours describe when she is EXPECTED INSIDE, so leaving
    -- during them is the alarming thing. Getting somewhere is reassurance
    -- whenever it happens, and at eleven at night it is worth more, not less.
    return 'enter';
  end if;

  if ev.kind = 'exit' then
    if not g.notify_departure then return null; end if;
    -- Same settle rule in the other direction, which the old path did not have:
    -- a phone wandering across the boundary could fire the departure alarm
    -- repeatedly, and the departure alarm is the loud one.
    if found and prev.kind = 'exit'
       and prev.created_at > ev.created_at - make_interval(
             mins => public.orbii_geofence_settle_minutes()) then
      return null;
    end if;
    -- The active-hours gate stays exactly where it was, in the app, because it
    -- is evaluated against IST wall-clock minutes there and duplicating that
    -- arithmetic in two places is how the two answers start disagreeing.
    return 'exit';
  end if;

  return null;
end $$;

revoke all on function public.geofence_event_should_alert(uuid) from public, anon;
grant execute on function public.geofence_event_should_alert(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'zones can be set to alert on arrival' as check,
       (exists (select 1 from information_schema.columns
                where table_name = 'geofences' and column_name = 'notify_arrival'))::text as result
union all
select 'existing zones keep alerting on departure (must be true)',
       (select coalesce(bool_and(notify_departure), true)::text from geofences)
union all
select 'the settle window (must be 10)',
       public.orbii_geofence_settle_minutes()::text
union all
select 'the app can ask about its own crossings (must be true)',
       public.orbii_can_exec('authenticated', 'public.geofence_event_should_alert(uuid)')
union all
select 'anon cannot (must be false)',
       has_function_privilege('anon', 'public.geofence_event_should_alert(uuid)', 'execute')::text
union all
-- An event id that does not exist must be silence, not an error. The caller is
-- a background OS task and an exception there costs the departure alarm too.
select 'an unknown event is silent, not an error (must be blank)',
       coalesce(public.geofence_event_should_alert('00000000-0000-0000-0000-000000000000'), '');
