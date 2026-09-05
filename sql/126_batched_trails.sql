-- 126_batched_trails.sql
-- ============================================================================
-- One query for every member's trail instead of one query per member.
--
-- THE PROBLEM, measured rather than guessed. Opening the circle map does:
--
--   1  circle_members_locations()      positions
--   N  circle_member_trail(uid)        one per visible member
--   2  listCircleMembers               rows, then profiles
--
-- With four people in a circle that is seven round trips before the screen is
-- finished, and each trail returns up to 500 rows. On a phone on Indian mobile
-- data at 200 to 400ms a trip, that is one and a half to three seconds of
-- staring at a map with nothing on it.
--
-- The N is the part that scales wrong. Collapsing it to one query makes the
-- cold open three trips regardless of circle size.
--
-- THE THINNING MOVES TO THE SERVER TOO. The app was fetching up to 2000 rows
-- across four members and then thinning them to ~120 points each in
-- JavaScript, on the main thread, on every roster change. Every one of those
-- discarded rows was serialised, sent over a mobile connection, parsed, and
-- thrown away. Sampling in SQL sends about a quarter of the data and does the
-- work on a machine that is not also drawing the screen.
--
-- Idempotent. Run after sql/125.
-- ============================================================================

-- How many points a drawn trail actually needs. Above this the extra vertices
-- are shorter than a pixel at any zoom a phone can show, so they cost bandwidth
-- and draw time and change nothing on screen.
create or replace function public.orbii_trail_points()
returns int language sql immutable as $$ select 120 $$;

revoke all on function public.orbii_trail_points() from public, anon;
grant execute on function public.orbii_trail_points() to authenticated, service_role;


-- Trails for several people at once, already thinned, already bubbled.
--
-- Note it reuses circle_member_trail rather than reimplementing the access
-- rules. That function carries the circle membership check, the retention
-- clamp and the precision blur from sql/123, and a second copy of those three
-- things would be three chances to drift apart on a table holding location
-- history.
create or replace function public.circle_trails(p_uids uuid[], p_hours int default 168)
returns table (user_id uuid, lat double precision, lng double precision, at timestamptz)
language sql stable security definer set search_path = public as $$
  with raw as (
    select u.uid as user_id, t.lat, t.lng, t.at,
           row_number() over (partition by u.uid order by t.at desc) as rn,
           count(*)      over (partition by u.uid)                   as total
    from unnest(p_uids) as u(uid)
    cross join lateral public.circle_member_trail(u.uid, p_hours) t
  )
  select r.user_id, r.lat, r.lng, r.at
  from raw r
  -- Even sampling, with the two endpoints always kept. A trail that loses its
  -- most recent point looks like she stopped somewhere she did not, and one
  -- that loses its oldest starts mid-journey.
  where r.total <= public.orbii_trail_points()
     or r.rn = 1
     or r.rn = r.total
     or r.rn % greatest(1, (r.total / public.orbii_trail_points())) = 0
  order by r.user_id, r.at desc;
$$;

revoke all on function public.circle_trails(uuid[], int) from public, anon;
grant execute on function public.circle_trails(uuid[], int) to authenticated;


-- ---------------------------------------------------------------------------
-- THE INDEX THAT MAKES ANY OF THIS FAST
-- ---------------------------------------------------------------------------
-- circle_location_history is the largest table in the schema and every trail
-- read filters on (user_id, at desc) and takes the newest rows. Without a
-- matching index that is a sequential scan plus a sort, per member, per open.
--
-- NOT CONCURRENTLY, though it should be. CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block and the Supabase SQL editor wraps the whole file
-- in one, so it fails with 25001 before anything else in the file runs.
--
-- A plain CREATE INDEX takes a write lock for the build. On this table today
-- that is milliseconds: it holds a few thousand rows on a young app. It will
-- not stay that way. Once circle_location_history is into the millions, run
-- the concurrent version by itself, outside any transaction:
--
--   create index concurrently if not exists circle_location_history_user_at_idx
--     on circle_location_history (user_id, at desc);
--
-- and drop this statement.
create index if not exists circle_location_history_user_at_idx
  on circle_location_history (user_id, at desc);


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'batched trails exist' as check,
       (to_regprocedure('public.circle_trails(uuid[],int)') is not null)::text as result
union all
select 'the app can read them (must be true)',
       public.orbii_can_exec('authenticated', 'public.circle_trails(uuid[],int)')
union all
select 'anon cannot (must be false)',
       has_function_privilege('anon', 'public.circle_trails(uuid[],int)', 'execute')::text
union all
select 'the history index is in place',
       (exists (select 1 from pg_indexes
                where indexname = 'circle_location_history_user_at_idx'))::text
union all
select 'points per trail', public.orbii_trail_points()::text
union all
-- An empty array must come back empty rather than erroring, because that is
-- exactly what the map sends before the roster has loaded.
select 'an empty request returns nothing, not an error (must be 0)',
       (select count(*)::text from public.circle_trails(array[]::uuid[], 168));
