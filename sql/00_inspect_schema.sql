-- ORBII schema inspector. Paste each block into the Supabase SQL editor,
-- run, and share the results. The trigger in sql/04_profile_triggers.sql
-- will be rewritten to match exactly what comes back.

-- ---------------------------------------------------------------------------
-- 1. List every column of every table the trigger touches.
--    Copy the output back to the assistant — that is what determines
--    which columns the trigger writes to.
-- ---------------------------------------------------------------------------
select
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in (
    'profiles',
    'users_public',
    'friends',
    'friend_requests',
    'messages',
    'sos_events',
    'emergency_contacts'
  )
order by table_name, ordinal_position;

-- ---------------------------------------------------------------------------
-- 2. List every primary key + unique constraint on those tables.
--    Tells us whether `id` is uuid / text, and which columns enforce
--    uniqueness (we need this to write correct ON CONFLICT clauses).
-- ---------------------------------------------------------------------------
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  string_agg(kcu.column_name, ', ' order by kcu.ordinal_position) as columns
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on kcu.constraint_name = tc.constraint_name
  and kcu.table_schema = tc.table_schema
where tc.table_schema = 'public'
  and tc.table_name in (
    'profiles',
    'users_public',
    'friends',
    'friend_requests',
    'messages',
    'sos_events',
    'emergency_contacts'
  )
  and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
group by tc.table_name, tc.constraint_name, tc.constraint_type
order by tc.table_name, tc.constraint_type desc, tc.constraint_name;

-- ---------------------------------------------------------------------------
-- 3. Show every RLS policy on those tables.
--    So the rewritten trigger can be SECURITY DEFINER without bypassing
--    a policy you actually want enforced.
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'profiles',
    'users_public',
    'friends',
    'friend_requests',
    'messages',
    'sos_events',
    'emergency_contacts'
  )
order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- 4. Confirm whether the trigger is currently installed.
--    (If you previously ran sql/04, this will list it.)
-- ---------------------------------------------------------------------------
select
  trigger_name,
  event_manipulation,
  event_object_schema,
  event_object_table,
  action_statement
from information_schema.triggers
where event_object_schema = 'auth'
  and event_object_table = 'users';

-- ---------------------------------------------------------------------------
-- 5. Sanity-check row counts. If profiles has rows but users_public is
--    empty, we know the search bug is purely a missing-mirror problem.
-- ---------------------------------------------------------------------------
select 'auth.users' as tbl, count(*) as rows from auth.users
union all
select 'profiles', count(*) from public.profiles
union all
select 'users_public', count(*) from public.users_public;
