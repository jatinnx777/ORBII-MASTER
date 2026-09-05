-- 121_presence_fields.sql
-- ============================================================================
-- Charging state and live speed on a member card, and the one guard that has
-- to land in the same migration as the column.
--
-- WHY CHARGING IS NOT COSMETIC. sql/118 alerts a circle when a phone drops to
-- 15 percent, on the reasoning that a dying phone is a safety pipeline about to
-- stop. A phone at 11 percent ON A CHARGER is not that. It is a phone that will
-- be fine in twenty minutes, sitting next to a cable at a desk.
--
-- Shipping the column without the guard means telling a circle their daughter
-- is about to drop off the map while she charges her phone in a lecture. That
-- is the single fastest way to teach people to swipe the alert away, and once
-- they do that they swipe away the real one too. So the column and the guard
-- go in together, never one and then the other.
--
-- WHY SPEED IS NULLABLE AND NOT ZERO. "We do not know how fast she is moving"
-- and "she is stationary" are different facts. Both platforms report an unknown
-- speed as a negative number, and a card rendering that as 0 km/h is lying
-- quietly. Null means the card shows nothing at all, which is correct.
--
-- Idempotent. Run after sql/120.
-- ============================================================================

alter table circle_locations
  add column if not exists charging  boolean,
  add column if not exists speed_kmh double precision;


-- ---------------------------------------------------------------------------
-- THE WRITE
-- ---------------------------------------------------------------------------
-- Both new parameters default to null, so every existing caller keeps working
-- and simply records nothing for them. That matters more than usual here: the
-- background location task and the SOS write both call this, and a signature
-- change that broke either would break the pipeline silently.
create or replace function public.set_circle_location(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null,
  p_charging boolean default null, p_speed_kmh double precision default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into circle_locations (
    user_id, lat, lng, accuracy_m, battery, charging, speed_kmh,
    updated_at, sharing, sharing_off_at
  )
  values (
    auth.uid(), p_lat, p_lng, p_acc, p_battery, p_charging, p_speed_kmh,
    now(), true, null
  )
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery,
        charging = excluded.charging, speed_kmh = excluded.speed_kmh,
        updated_at = now(), sharing = true, sharing_off_at = null;
  insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
end $$;

revoke all on function public.set_circle_location(double precision, double precision, double precision, int, boolean, double precision)
  from public, anon;
grant execute on function public.set_circle_location(double precision, double precision, double precision, int, boolean, double precision)
  to authenticated;

-- The four argument form still exists as a separate overload and still works.
-- It is left alone deliberately: an app that has not been updated yet keeps
-- writing positions rather than failing, and a safety app must never lose the
-- location pipeline to a schema change.


-- ---------------------------------------------------------------------------
-- THE READ
-- ---------------------------------------------------------------------------
-- Drop-first again, because the returned columns change and `create or
-- replace` refuses that with 42P13. Same milliseconds-long window where the
-- RPC does not exist, same recovery on the next poll.
drop function if exists public.circle_members_locations();

create function public.circle_members_locations()
returns table (
  user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, updated_at timestamptz,
  battery int, accuracy_m double precision, sharing boolean, sharing_off_at timestamptz,
  emergency boolean, age_seconds int, unreachable boolean,
  charging boolean, speed_kmh double precision
)
language sql security definer set search_path = public as $$
  select l.user_id, u.name, u.photo_url, l.lat, l.lng, l.updated_at,
         l.battery, l.accuracy_m, l.sharing, l.sharing_off_at,
         public.orbii_has_active_sos(l.user_id) as emergency,
         extract(epoch from (now() - l.updated_at))::int as age_seconds,
         (l.sharing and l.updated_at < now() - interval '20 minutes') as unreachable,
         l.charging,
         -- A negative speed is both platforms' way of saying "unknown". Passed
         -- through as null so the card shows nothing rather than 0 km/h.
         case when l.speed_kmh >= 0 then l.speed_kmh else null end as speed_kmh
  from circle_locations l
  join users_public u on u.id = l.user_id
  where l.user_id <> auth.uid()
    and public.shares_circle_with(l.user_id)
    and (
      (l.sharing and l.updated_at > now() - interval '1 day')
      or (not l.sharing and l.updated_at > now() - interval '7 days')
      or public.orbii_has_active_sos(l.user_id)
    )
  order by public.orbii_has_active_sos(l.user_id) desc, l.sharing desc, l.updated_at desc;
$$;

revoke all on function public.circle_members_locations() from public, anon;
grant execute on function public.circle_members_locations() to authenticated;


-- ---------------------------------------------------------------------------
-- THE GUARD
-- ---------------------------------------------------------------------------
-- The only functional change in this file, and the reason it exists at all.
create or replace function public.circle_presence_sweep()
returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n int := 0;
begin
  delete from circle_presence_alerts a
  using circle_locations l
  where a.user_id = l.user_id
    and (
      (a.kind = 'low_battery' and (
         -- Recovered, either by charging up past the band or by being plugged
         -- in at all. Plugging in clears the memo immediately, so unplugging
         -- again later can warn a second time.
         (l.battery is not null and l.battery > public.orbii_low_battery_pct() + 5)
         or coalesce(l.charging, false)
       ))
      or (a.kind = 'unreachable' and l.updated_at > now() - interval '20 minutes')
    );

  for r in
    select l.user_id,
           u.name,
           l.battery,
           (l.updated_at < now() - interval '20 minutes') as gone,
           (l.battery is not null
             and l.battery <= public.orbii_low_battery_pct()
             -- THE GUARD. A phone on a charger is not about to stop reporting.
             and not coalesce(l.charging, false)) as low
    from circle_locations l
    join users_public u on u.id = l.user_id
    where l.sharing
      and not public.orbii_has_active_sos(l.user_id)
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
          'body', 'Battery at ' || r.battery || '%. Their location may stop updating soon.',
          'data', jsonb_build_object('kind', 'presence_low_battery', 'userId', r.user_id)
        ),
        7::smallint
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


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'charging and speed are recorded' as check,
       (select count(*) = 2 from information_schema.columns
        where table_name = 'circle_locations'
          and column_name in ('charging', 'speed_kmh'))::text as result
union all
select 'the read exposes them',
       (pg_get_function_result(to_regprocedure('public.circle_members_locations()')) ~ 'charging'
        and pg_get_function_result(to_regprocedure('public.circle_members_locations()')) ~ 'speed_kmh')::text
union all
-- The guard, read out of the live function body. A low-battery alert that
-- still fires for a charging phone is the failure this file exists to prevent.
select 'a charging phone cannot raise a low battery alert',
       (select prosrc ~ 'not coalesce\(l\.charging' from pg_proc
        where proname = 'circle_presence_sweep' and pronamespace = 'public'::regnamespace)::text
union all
-- The old four-argument form must survive, or an app that has not updated
-- stops writing locations at all.
select 'the old write signature still exists (must be true)',
       (to_regprocedure('public.set_circle_location(double precision,double precision,double precision,int)') is not null)::text
union all
select 'the new write signature exists (must be true)',
       (to_regprocedure('public.set_circle_location(double precision,double precision,double precision,int,boolean,double precision)') is not null)::text
union all
select 'the app can still read the roster (must be true)',
       public.orbii_can_exec('authenticated', 'public.circle_members_locations()')
union all
select 'anon cannot (must be false)',
       has_function_privilege('anon', 'public.circle_members_locations()', 'execute')::text;
