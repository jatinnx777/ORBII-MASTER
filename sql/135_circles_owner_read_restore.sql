-- 135_circles_owner_read_restore.sql
-- ============================================================================
-- THE FIX. Restores the owner's right to read their own circle.
--
-- SYMPTOM
--   "new row violates row-level security policy for table circles", on every
--   circle creation, for every user, while correctly signed in.
--
-- WHAT WAS WRONG
--   The live SELECT policy was the sql/09 version:
--
--       using (is_circle_member(id))
--
--   sql/14 added `or auth.uid() = owner_id` and sql/44 kept it. The database
--   had neither. Migration drift: the files were right, the database was two
--   revisions behind.
--
-- WHY A *SELECT* POLICY BREAKS AN *INSERT*
--   createCircle calls .insert(...).select('*').single(), so PostgREST sends
--   INSERT ... RETURNING *. PostgreSQL applies SELECT policies to rows
--   returned by RETURNING. The triggers that add the owner to circle_members
--   are AFTER INSERT, so when RETURNING is evaluated the creator is not yet a
--   member of the circle they are creating. The read is denied and the error
--   names `circles`.
--
--   Every bare-INSERT probe passed while the app failed, because an insert
--   without RETURNING never reaches the SELECT policy at all.
--
-- NO TRANSACTION CONTROL IN THIS FILE.
--   The first version ended with `rollback;` to undo its own verify insert.
--   The Supabase SQL editor runs a script as ONE transaction, so that rollback
--   discarded the policy change as well, and the fix never committed. The
--   verify is a separate file now: sql/checks/circles_returning_verify.sql.
--
-- Idempotent.
-- ============================================================================

drop policy if exists "circles read members" on public.circles;
create policy "circles read members"
  on public.circles for select
  to authenticated
  using (
    -- Load-bearing for creation, not just for browsing: without this clause
    -- INSERT ... RETURNING cannot read back the row it just wrote.
    auth.uid() = owner_id
    or public.is_circle_member(id)
  );


-- ---------------------------------------------------------------------------
-- Read the policy back. If `using_expr` does not mention owner_id, the change
-- did not commit and nothing below it is worth trying.
-- ---------------------------------------------------------------------------
select
  policyname,
  cmd,
  coalesce(qual, '(no using)') as using_expr
from pg_policies
where schemaname = 'public'
  and tablename  = 'circles'
  and cmd        = 'SELECT';
