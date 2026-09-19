-- circles_rls_diagnose.sql
-- ============================================================================
-- READ ONLY. Changes nothing. Paste into the Supabase SQL editor and send the
-- output back.
--
-- Answers the three questions that separate the possible causes of a circles
-- RLS failure, which have completely different fixes:
--
--   1. Has a policy on circle_members started reading circle_members again?
--      That is 42P17 recursion, the bug sql/10, 61, 84 and 85 all exist for,
--      and it takes the whole feature dark at once.
--   2. Do the functions the app calls actually exist? A migration that was
--      never run shows up to a user as an error on a button, and PostgREST
--      words a missing function badly enough to look like a permissions
--      problem.
--   3. Which policies are actually live on the circle tables right now, with
--      their real expressions, rather than what the migration files say.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. RECURSION: does any policy ON circle_members read FROM circle_members?
-- ---------------------------------------------------------------------------
select
  '1. recursion check' as section,
  policyname,
  cmd,
  coalesce(qual, '') as using_expr,
  coalesce(with_check, '') as with_check_expr,
  case
    when coalesce(qual, '') || coalesce(with_check, '') ~* 'circle_members'
      then 'RECURSIVE, THIS IS THE BUG'
    else 'ok'
  end as verdict
from pg_policies
where schemaname = 'public'
  and tablename = 'circle_members'
order by policyname;


-- ---------------------------------------------------------------------------
-- 2. FUNCTIONS THE APP CALLS. Missing means the migration never ran.
-- ---------------------------------------------------------------------------
select
  '2. functions' as section,
  needed.fn,
  case when p.proname is null then 'MISSING, RUN THE MIGRATION' else 'present' end as status,
  needed.introduced_in
from (
  values
    ('is_circle_member',      'sql/85'),
    ('join_circle_by_code',   'sql/125'),
    ('rotate_circle_code',    'sql/125'),
    ('orbii_new_join_code',   'sql/125'),
    ('orbii_join_alphabet',   'sql/125')
) as needed(fn, introduced_in)
left join pg_proc p
  on p.proname = needed.fn
 and p.pronamespace = 'public'::regnamespace
order by status desc, needed.fn;


-- ---------------------------------------------------------------------------
-- 3. EVERY LIVE POLICY ON THE CIRCLE TABLES
-- ---------------------------------------------------------------------------
select
  '3. live policies' as section,
  tablename,
  policyname,
  cmd,
  roles::text as roles,
  coalesce(qual, '') as using_expr,
  coalesce(with_check, '') as with_check_expr
from pg_policies
where schemaname = 'public'
  and tablename in (
    'circles', 'circle_members', 'circle_invites',
    'circle_locations', 'circle_visits', 'circle_location_prefs'
  )
order by tablename, policyname;


-- ---------------------------------------------------------------------------
-- 4. IS RLS EVEN ON, AND CAN authenticated REACH THE TABLES
-- ---------------------------------------------------------------------------
select
  '4. table state' as section,
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced,
  has_table_privilege('authenticated', c.oid, 'SELECT') as authed_can_select,
  has_table_privilege('authenticated', c.oid, 'INSERT') as authed_can_insert
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'circles', 'circle_members', 'circle_invites',
    'circle_locations', 'circle_visits', 'circle_location_prefs'
  )
order by c.relname;
