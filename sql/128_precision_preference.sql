-- 128_precision_preference.sql
-- ============================================================================
-- Approximate sharing was unsettable for anyone who had not shared yet, and it
-- said it had saved.
--
-- THE BUG. set_location_precision (sql/123) is a bare UPDATE on
-- circle_locations. That table's lat and lng are NOT NULL (sql/63), so a row
-- only exists once somebody has actually shared a position. sql/123 knew this
-- and left a comment saying the next write would carry the setting instead.
--
-- It does not. set_circle_location (sql/121) inserts without naming
-- precision_m, so the column takes its default of null on that first write.
-- The preference is not deferred, it is discarded.
--
-- The function returns void, so the update matching zero rows is indisputably
-- silent: the client gets no error and tells her the setting is on. On a
-- privacy control that is the worst possible failure. She believes she is
-- sharing a neighbourhood and she is sharing a doorway.
--
-- WHY A SEPARATE TABLE. The preference has to outlive the absence of a
-- position, and circle_locations cannot hold it without a fake coordinate.
-- One row per person, no location in it, and it survives sharing being turned
-- off and on again.
--
-- circle_locations.precision_m stays the operative value that the read path
-- uses, so nothing about sql/123's bubble logic changes. This file only makes
-- sure that column ends up holding what she actually chose.
--
-- Idempotent. Run after sql/127.
-- ============================================================================

create table if not exists circle_location_prefs (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  precision_m int check (precision_m is null or precision_m between 100 and 5000),
  updated_at timestamptz not null default now()
);

alter table circle_location_prefs enable row level security;

-- Readable by its owner alone. A circle member sees the EFFECT of somebody's
-- precision in the bubbled coordinate they receive; they have no business
-- reading the setting itself, because "she has hidden her exact position from
-- you" is a fact about her, not about the map.
drop policy if exists circle_location_prefs_own on circle_location_prefs;
create policy circle_location_prefs_own on circle_location_prefs
  for select to authenticated
  using (user_id = auth.uid());

-- Writes go through the definer function below only.
revoke all on table circle_location_prefs from public, anon;
grant select on table circle_location_prefs to authenticated;


-- ---------------------------------------------------------------------------
-- THE SETTER, WHICH NOW STORES THE PREFERENCE AND SAYS WHAT IT DID
-- ---------------------------------------------------------------------------
-- Drop first: the return type changes from void to boolean and `create or
-- replace` refuses that with 42P13.
drop function if exists public.set_location_precision(int);

create function public.set_location_precision(p_metres int default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_live boolean;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if p_metres is not null and (p_metres < 100 or p_metres > 5000) then
    raise exception 'precision must be between 100 and 5000 metres';
  end if;

  -- The preference, which is now kept whether or not she is sharing.
  insert into circle_location_prefs (user_id, precision_m, updated_at)
  values (auth.uid(), p_metres, now())
  on conflict (user_id) do update
    set precision_m = excluded.precision_m, updated_at = now();

  -- The operative value, if there is a position to apply it to.
  update circle_locations set precision_m = p_metres where user_id = auth.uid();
  v_live := found;

  -- True means it is in force right now. False means it is stored and will
  -- apply the moment she starts sharing, which is a different sentence and the
  -- UI is expected to say so rather than claiming success either way.
  return v_live;
end $$;

revoke all on function public.set_location_precision(int) from public, anon;
grant execute on function public.set_location_precision(int) to authenticated;


-- ---------------------------------------------------------------------------
-- THE READER
-- ---------------------------------------------------------------------------
-- Without this the app had no way to show the current setting, so the sheet
-- would have had to remember the choice on the device. A privacy setting whose
-- displayed state comes from local storage is one reinstall away from telling
-- her she is sharing a neighbourhood while the server shares a doorway.
create or replace function public.my_location_precision()
returns int
language sql security definer stable set search_path = public as $$
  select precision_m from circle_location_prefs where user_id = auth.uid();
$$;

revoke all on function public.my_location_precision() from public, anon;
grant execute on function public.my_location_precision() to authenticated;


-- ---------------------------------------------------------------------------
-- THE FIRST WRITE CARRIES THE PREFERENCE
-- ---------------------------------------------------------------------------
-- This is the half sql/123 assumed already existed. Both overloads are updated:
-- the four argument form is still what an app that has not updated calls, and
-- a woman on an old build who set a radius should not be sharing an exact
-- position because of it.
--
-- The subquery is a primary key lookup on a table with one row per person, on
-- a path that already does two writes.
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
    updated_at, sharing, sharing_off_at, precision_m
  )
  values (
    auth.uid(), p_lat, p_lng, p_acc, p_battery, p_charging, p_speed_kmh,
    now(), true, null,
    (select precision_m from circle_location_prefs where user_id = auth.uid())
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

create or replace function public.set_circle_location(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into circle_locations (
    user_id, lat, lng, accuracy_m, battery,
    updated_at, sharing, sharing_off_at, precision_m
  )
  values (
    auth.uid(), p_lat, p_lng, p_acc, p_battery,
    now(), true, null,
    (select precision_m from circle_location_prefs where user_id = auth.uid())
  )
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery,
        updated_at = now(), sharing = true, sharing_off_at = null;
  insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
end $$;

revoke all on function public.set_circle_location(double precision, double precision, double precision, int)
  from public, anon;
grant execute on function public.set_circle_location(double precision, double precision, double precision, int)
  to authenticated;


-- ---------------------------------------------------------------------------
-- BACKFILL
-- ---------------------------------------------------------------------------
-- Anybody who already set a radius under sql/123 has it on circle_locations
-- and nowhere else. Copy it across so turning sharing off and on again does
-- not quietly reset them to exact.
insert into circle_location_prefs (user_id, precision_m)
select user_id, precision_m from circle_locations where precision_m is not null
on conflict (user_id) do nothing;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'a preference survives never having shared' as check,
       (to_regclass('public.circle_location_prefs') is not null)::text as result
union all
select 'the setter reports whether it is in force',
       (select pg_get_function_result(oid) = 'boolean'
          from pg_proc where oid = 'public.set_location_precision(int)'::regprocedure)::text
union all
select 'the app can read its own setting back',
       (to_regprocedure('public.my_location_precision()') is not null)::text
union all
select 'the first position written carries the preference',
       (select prosrc like '%circle_location_prefs%'
          from pg_proc
         where oid = 'public.set_circle_location(double precision, double precision, double precision, int, boolean, double precision)'::regprocedure)::text
union all
select 'the legacy four argument form carries it too',
       (select prosrc like '%circle_location_prefs%'
          from pg_proc
         where oid = 'public.set_circle_location(double precision, double precision, double precision, int)'::regprocedure)::text
union all
select 'nobody can read another person''s setting',
       (exists (select 1 from pg_policies
                 where tablename = 'circle_location_prefs'
                   and policyname = 'circle_location_prefs_own'))::text
union all
select 'anon cannot call the setter (must be false)',
       public.orbii_can_exec('anon', 'public.set_location_precision(int)')
union all
select 'preferences carried over from sql/123',
       (select count(*)::text from circle_location_prefs);
