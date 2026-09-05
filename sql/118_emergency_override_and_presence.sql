-- 118_emergency_override_and_presence.sql
-- ============================================================================
-- Two defects in the emergency pipeline, and the presence data the circle map
-- needs to stop lying about how old a pin is.
--
-- DEFECT 1: HER PIN GREYS OUT DURING AN EMERGENCY.
--
-- circle_members_locations() filters on the sharing flag. Sharing is a
-- bounded, opt-in window: "share with my circle for 2 hours". When that window
-- expires the row stays but `sharing` goes false, the app greys the pin, and
-- the read only returns positions up to 7 days old with no live updates behind
-- them.
--
-- Now put an SOS in the middle of that. She turned sharing on for the walk
-- home, it lapsed, and two hours later she says the word. Her mother opens the
-- circle map during the emergency and sees a grey pin where her daughter was
-- at nine o'clock.
--
-- The rule this adds: AN ACTIVE SOS OUTRANKS A SHARING SETTING. Not "sharing
-- is turned on for her", which would be a lie about consent and would outlive
-- the emergency. The row is released for exactly as long as the SOS is active,
-- it is labelled as an emergency release rather than as sharing, and it closes
-- by itself when the SOS is resolved.
--
-- This is a defensible reading of consent, not a bypass of it: an SOS IS the
-- request. A safety app whose location sharing is unavailable during the one
-- event it was installed for has the feature and not the function.
--
-- DEFECT 2: A DEAD PIN LOOKS LIKE A LIVE ONE.
--
-- The read returns updated_at and nothing else, so a fix from four minutes ago
-- and one from four days ago arrive identically shaped. The app has a
-- freshness() helper on ONE screen. Everywhere else, including the history
-- sheet a parent actually reads, forty minutes old renders like now.
--
-- Age is now computed server-side and returned with the row, so no screen can
-- forget to ask. `unreachable` is the specific state that matters: a phone
-- that has stopped reporting while sharing is still on. That is the shape of a
-- dead battery, a forced stop, or no signal, and it is the one thing a circle
-- should be told about rather than left to notice.
--
-- Also: the battery column has been in this table since sql/70 and the app has
-- written null to it every single time (circle-location.ts passes p_battery:
-- null in both call sites). The column is not new. The data is.
--
-- Idempotent. Run after sql/117.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- IS THIS PERSON IN AN EMERGENCY RIGHT NOW
-- ---------------------------------------------------------------------------
-- Same definition of "active" as my_circle_active_sos in sql/113: status
-- active, kind real. Drills excluded on purpose, because an override that
-- fires on a drill teaches people the override is noise.
create or replace function public.orbii_has_active_sos(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sos_events e
    where e.user_id = p_user
      and e.status = 'active'
      and e.kind = 'real'
  );
$$;

revoke all on function public.orbii_has_active_sos(uuid) from public, anon;
grant execute on function public.orbii_has_active_sos(uuid) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- THE READ
-- ---------------------------------------------------------------------------
-- Three columns added, and one filter that an emergency can now pass.
--
--   emergency      This row is visible because of an active SOS, not because
--                  sharing is on. The app must say so in those words. Showing
--                  it as ordinary sharing would misrepresent what she agreed
--                  to, and the distinction is the whole reason the flag is
--                  separate from `sharing`.
--
--   age_seconds    How old the fix is, computed once, server-side. Every
--                  screen gets the same answer and none of them has to
--                  remember to work it out.
--
--   unreachable    Sharing is on and nothing has arrived in 20 minutes. The
--                  interval is deliberately not tight: a phone in a pocket on
--                  a train misses fixes constantly, and an alert that fires on
--                  ordinary signal loss is an alert people learn to ignore.
-- DROP first, not `create or replace`. Postgres refuses to replace a function
-- whose OUT parameters change, and this one gains three columns, so the
-- replace fails with 42P13 rather than doing anything.
--
-- Dropping is safe here but not free: for the moment between this statement
-- and the create below, the app's RPC does not exist and any live circle map
-- gets an error instead of a roster. The window is milliseconds and the map
-- polls, so the next tick recovers. Worth knowing rather than discovering.
--
-- The drop also discards the function's grants, which is why the revoke and
-- grant below are not optional: after sql/116 changed the schema default, a
-- freshly created function is executable by NOBODY until it is granted, and a
-- missing grant here would surface in the app as "function does not exist".
drop function if exists public.circle_members_locations();

create function public.circle_members_locations()
returns table (
  user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, updated_at timestamptz,
  battery int, accuracy_m double precision, sharing boolean, sharing_off_at timestamptz,
  emergency boolean, age_seconds int, unreachable boolean
)
language sql security definer set search_path = public as $$
  select l.user_id, u.name, u.photo_url, l.lat, l.lng, l.updated_at,
         l.battery, l.accuracy_m, l.sharing, l.sharing_off_at,
         public.orbii_has_active_sos(l.user_id) as emergency,
         extract(epoch from (now() - l.updated_at))::int as age_seconds,
         (l.sharing and l.updated_at < now() - interval '20 minutes') as unreachable
  from circle_locations l
  join users_public u on u.id = l.user_id
  where l.user_id <> auth.uid()
    and public.shares_circle_with(l.user_id)
    and (
      (l.sharing and l.updated_at > now() - interval '1 day')
      or (not l.sharing and l.updated_at > now() - interval '7 days')
      -- The override. An active SOS releases the row whatever the sharing
      -- state and whatever the age, because during an emergency the last
      -- known position is the most valuable thing in this table even when it
      -- is old. It stops the moment the SOS is resolved.
      or public.orbii_has_active_sos(l.user_id)
    )
  -- Emergencies first, then live sharers, then the rest. A parent opening this
  -- screen during an SOS should not have to scroll.
  order by public.orbii_has_active_sos(l.user_id) desc, l.sharing desc, l.updated_at desc;
$$;

revoke all on function public.circle_members_locations() from public, anon;
grant execute on function public.circle_members_locations() to authenticated;


-- ---------------------------------------------------------------------------
-- THE WRITE, DURING AN EMERGENCY
-- ---------------------------------------------------------------------------
-- The read above releases her last known position during an SOS, but a last
-- known position from two hours ago is not what her circle needs. The device
-- has to keep pushing, and it cannot use set_circle_location to do it.
--
-- WHY NOT. set_circle_location sets `sharing = true, sharing_off_at = null` on
-- every write. Calling it during an emergency would switch her live sharing on
-- PERMANENTLY, outliving the SOS, and erase the record of when she had turned
-- it off. She would end an emergency having silently opted into something she
-- never chose, which is precisely the thing that makes people uninstall a
-- safety app and tell their friends why.
--
-- So this writes position and nothing else. `sharing` and `sharing_off_at` are
-- never touched, and a row created here for someone who has never shared is
-- created with sharing FALSE: it is visible through the emergency override, not
-- through a consent she did not give.
--
-- The guard is server-side and returns false rather than raising, because the
-- caller is a background location task during an emergency and an exception
-- there is worth nothing to anybody.
create or replace function public.set_circle_location_sos(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null
)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  -- Refuses unless the caller is genuinely in an emergency. Without this the
  -- function would be a way for any signed-in account to write its position
  -- into a circle while appearing not to share, which is worse than the
  -- problem it solves.
  if not public.orbii_has_active_sos(auth.uid()) then
    return false;
  end if;

  insert into circle_locations (user_id, lat, lng, accuracy_m, battery, updated_at, sharing)
    values (auth.uid(), p_lat, p_lng, p_acc, p_battery, now(), false)
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery,
        updated_at = now();
        -- sharing and sharing_off_at are deliberately absent from this SET.

  insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
  return true;
end $$;

revoke all on function public.set_circle_location_sos(double precision, double precision, double precision, int)
  from public, anon;
grant execute on function public.set_circle_location_sos(double precision, double precision, double precision, int)
  to authenticated;


-- ---------------------------------------------------------------------------
-- PRESENCE ALERTS: LOW BATTERY AND UNREACHABLE
-- ---------------------------------------------------------------------------
-- Both of these are the same thing said two ways: THE PIPELINE IS ABOUT TO
-- FAIL AND NOBODY HAS BEEN TOLD. A phone at 8% will not be sending anything in
-- an hour. A phone that stopped reporting twenty minutes ago already isn't.
-- Neither is an emergency, and neither should be dressed as one.
--
-- Fired from pg_cron rather than the device, because the device is exactly
-- what cannot be relied on to report its own silence.
create table if not exists circle_presence_alerts (
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('low_battery', 'unreachable')),
  sent_at    timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table circle_presence_alerts enable row level security;
-- No policy, deliberately. Nothing reads this from a client; it exists only so
-- the sweep below can remember what it already said.

/** Below this, a phone has hours left at best. */
create or replace function public.orbii_low_battery_pct()
returns int language sql immutable as $$ select 15 $$;

revoke all on function public.orbii_low_battery_pct() from public, anon;
grant execute on function public.orbii_low_battery_pct() to authenticated, service_role;

-- Everyone who shares a live circle with this person, which is who gets told.
-- Same membership rules as everywhere else: tombstones excluded on both sides,
-- revocations excluded even where a membership row survives.
create or replace function public.orbii_circle_peers(p_user uuid)
returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct b.user_id
  from circle_members a
  join circle_members b on a.circle_id = b.circle_id
  where a.user_id = p_user
    and b.user_id <> p_user
    and a.deleted_at is null
    and b.deleted_at is null
    and not exists (
      select 1 from circle_revocations rv
      where rv.circle_id = a.circle_id and rv.user_id = b.user_id
    );
$$;

revoke all on function public.orbii_circle_peers(uuid) from public, anon;
grant execute on function public.orbii_circle_peers(uuid) to service_role;

-- One alert per person per state, cleared when the state clears, so a phone
-- hovering at the threshold cannot notify a circle every five minutes. This is
-- the entire reason the table above exists.
create or replace function public.circle_presence_sweep()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  -- Clear the memory for anyone who has recovered, so the next genuine dip
  -- alerts again. Done first: a phone that charged and drained inside one
  -- sweep interval should still be able to warn a second time.
  delete from circle_presence_alerts a
  using circle_locations l
  where a.user_id = l.user_id
    and (
      (a.kind = 'low_battery' and l.battery is not null
         and l.battery > public.orbii_low_battery_pct() + 5)
      or (a.kind = 'unreachable' and l.updated_at > now() - interval '20 minutes')
    );

  for r in
    select l.user_id,
           u.name,
           l.battery,
           (l.updated_at < now() - interval '20 minutes') as gone,
           (l.battery is not null and l.battery <= public.orbii_low_battery_pct()) as low
    from circle_locations l
    join users_public u on u.id = l.user_id
    where l.sharing                                   -- never alert about someone who is not sharing
      and not public.orbii_has_active_sos(l.user_id)  -- an SOS says it louder already
  loop
    if r.low and not exists (
      select 1 from circle_presence_alerts a
      where a.user_id = r.user_id and a.kind = 'low_battery'
    ) then
      insert into circle_presence_alerts (user_id, kind) values (r.user_id, 'low_battery');
      perform public.push_enqueue(
        array(
          select t.token from push_tokens t
          where t.user_id in (select m from public.orbii_circle_peers(r.user_id) m)
        ),
        jsonb_build_object(
          'title', coalesce(r.name, 'Someone') || '''s phone is low',
          -- Says what it means for them, not what the number is. "23% battery"
          -- is a fact; "may stop sharing soon" is the reason to care.
          'body', 'Battery at ' || r.battery || '%. Their location may stop updating soon.',
          'data', jsonb_build_object('kind', 'presence_low_battery', 'userId', r.user_id)
        ),
        7::smallint  -- well below an SOS, which runs at 1
      );
      n := n + 1;
    end if;

    if r.gone and not exists (
      select 1 from circle_presence_alerts a
      where a.user_id = r.user_id and a.kind = 'unreachable'
    ) then
      insert into circle_presence_alerts (user_id, kind) values (r.user_id, 'unreachable');
      perform public.push_enqueue(
        array(
          select t.token from push_tokens t
          where t.user_id in (select m from public.orbii_circle_peers(r.user_id) m)
        ),
        jsonb_build_object(
          'title', coalesce(r.name, 'Someone') || ' stopped updating',
          -- Deliberately not alarming. The overwhelming majority of these are
          -- a basement or a dead battery, and a notification that reads like
          -- an emergency for a metro tunnel is one people turn off.
          'body', 'No location for 20 minutes. Their phone may be off or out of signal.',
          'data', jsonb_build_object('kind', 'presence_unreachable', 'userId', r.user_id)
        ),
        7::smallint
      );
      n := n + 1;
    end if;
  end loop;

  return n;
end $$;

revoke all on function public.circle_presence_sweep() from public, anon, authenticated;
grant execute on function public.circle_presence_sweep() to service_role;


-- Every five minutes. Fast enough that "stopped updating" means something,
-- slow enough that the sweep is nearly free.
select cron.unschedule('orbii-presence-sweep')
  where exists (select 1 from cron.job where jobname = 'orbii-presence-sweep');

select cron.schedule('orbii-presence-sweep', '*/5 * * * *',
  $$ select public.circle_presence_sweep(); $$);


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'the read exposes emergency, age_seconds and unreachable' as check,
       (pg_get_function_result(to_regprocedure('public.circle_members_locations()'))
          ~ 'emergency'
        and pg_get_function_result(to_regprocedure('public.circle_members_locations()'))
          ~ 'age_seconds'
        and pg_get_function_result(to_regprocedure('public.circle_members_locations()'))
          ~ 'unreachable')::text as result
union all
select 'an active SOS is detectable',
       (to_regprocedure('public.orbii_has_active_sos(uuid)') is not null)::text
union all
select 'the presence sweep is scheduled',
       (exists (select 1 from cron.job where jobname = 'orbii-presence-sweep'))::text
union all
select 'low battery threshold', public.orbii_low_battery_pct()::text
union all
-- The sweep can send a push to anyone in a circle, so a signed-in user must
-- not be able to call it. This is the check sql/116 taught me to write.
select 'a signed-in user cannot run the sweep (must be false)',
       public.orbii_can_exec('authenticated', 'public.circle_presence_sweep()')
union all
select 'a signed-in user cannot enumerate a stranger''s circle (must be false)',
       public.orbii_can_exec('authenticated', 'public.orbii_circle_peers(uuid)')
union all
select 'the app can still read circle locations (must be true)',
       public.orbii_can_exec('authenticated', 'public.circle_members_locations()')
union all
-- Calling it without an SOS must be a no-op, not a write. If this ever returns
-- true, the emergency write has become an ordinary one and the sharing flag it
-- was built to protect is protecting nothing.
select 'the emergency write refuses a caller with no SOS (must be false)',
       public.set_circle_location_sos(0, 0)::text;
