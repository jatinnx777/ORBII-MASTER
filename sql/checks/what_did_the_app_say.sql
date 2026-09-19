-- what_did_the_app_say.sql
-- ============================================================================
-- Reads what YOUR PHONE reported, rather than what I infer from the repo.
-- Read only.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. DID sql/132 ACTUALLY APPLY?
-- ---------------------------------------------------------------------------
-- The fix is the words `deleted_at is null` inside each trigger function. If
-- either says false, 132 did not run or did not take.
select
  '1. is the 132 fix live' as section,
  p.proname as function_name,
  (pg_get_functiondef(p.oid) ~* 'deleted_at is null') as fix_applied
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('on_circle_created', 'add_circle_owner_member')
order by p.proname;


-- ---------------------------------------------------------------------------
-- 2. WHAT THE APP ACTUALLY REPORTED, MOST RECENT FIRST
-- ---------------------------------------------------------------------------
-- This is the real error text from the device, with its breadcrumbs.
select
  '2. client errors' as section,
  created_at,
  category,
  message,
  data,
  platform
from client_errors
order by created_at desc
limit 20;


-- ---------------------------------------------------------------------------
-- 3. DID ANY CIRCLE GET CREATED RECENTLY?
-- ---------------------------------------------------------------------------
-- If rows appear here, creation is working and the app is failing AFTER the
-- insert, on something else entirely.
select
  '3. recent circles' as section,
  id,
  name,
  owner_id,
  created_at
from circles
order by created_at desc
limit 10;


-- ---------------------------------------------------------------------------
-- 4. AND DID THE OWNER MEMBERSHIP LAND FOR THOSE?
-- ---------------------------------------------------------------------------
select
  '4. owner rows for recent circles' as section,
  c.name,
  c.created_at,
  (select count(*) from circle_members m
    where m.circle_id = c.id and m.deleted_at is null) as live_members
from circles c
order by c.created_at desc
limit 10;
