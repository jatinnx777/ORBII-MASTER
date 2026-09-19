-- 136_app_events_select_grant.sql
-- ============================================================================
-- Stops the 403 storm on app_events, which fires several times a second per
-- device and is a large part of why the app feels slow.
--
-- WHAT WAS WRONG
--   sql/110 made the table write-only on purpose:
--
--       revoke select, update, delete on app_events from anon, authenticated;
--       grant insert on app_events to authenticated;
--
--   The intent is right, but PostgREST does not send a bare INSERT. From your
--   own Postgres log, it sends:
--
--       WITH pgrst_source AS (INSERT INTO app_events(...) RETURNING 1)
--       SELECT pg_catalog.count(_postgrest_t) ... FROM (SELECT * FROM
--       pgrst_source) _postgrest_t
--
--   The reported Command on the failing entry was SELECT, not INSERT. Without
--   the SELECT privilege the whole statement is rejected before the insert
--   happens, so every analytics event and every client error report has been
--   discarded with 42501. That is why client_errors was empty every time it
--   was checked: not "no errors", but "cannot write".
--
-- WHY GRANTING SELECT DOES NOT LEAK ANYTHING
--   Row level security is enabled on app_events and there is NO select policy
--   on it. With RLS on and no policy for a command, that command returns zero
--   rows. The grant lets PostgREST's wrapper run; the absent policy still
--   makes the table unreadable. sql/110 line 279 already asserts this
--   property. Privacy is enforced by the policy, not by withholding the grant.
--
-- No transaction control in this file, so nothing can roll the change back.
-- Idempotent.
-- ============================================================================

grant select on table public.app_events to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY. Both rows must be as described or the grant is not safe to keep.
-- ---------------------------------------------------------------------------
select
  'rls is enabled on app_events (must be true)' as check,
  relrowsecurity::text as result
from pg_class
where oid = 'public.app_events'::regclass

union all

select
  'select policies on app_events (must be 0, this is what hides the rows)',
  count(*)::text
from pg_policies
where schemaname = 'public'
  and tablename  = 'app_events'
  and cmd        = 'SELECT'

union all

select
  'authenticated can now run the insert wrapper (must be true)',
  has_table_privilege('authenticated', 'public.app_events', 'SELECT')::text;
