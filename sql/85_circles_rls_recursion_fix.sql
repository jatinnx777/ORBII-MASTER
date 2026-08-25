-- 85_circles_rls_recursion_fix.sql
-- ============================================================================
-- Undo an RLS recursion I introduced in sql/84.
--
-- WHAT BROKE. sql/84 added this policy ON circle_members:
--
--   create policy circle_members_sel on circle_members
--     for select using (
--       deleted_at is null
--       and ( user_id = auth.uid()
--             or exists (select 1 from circle_members me where ...) )
--     );
--
-- The EXISTS reads circle_members from inside a policy on circle_members. That
-- subquery is itself subject to the same policy, which runs the same subquery,
-- and Postgres stops it with:
--
--   42P17: infinite recursion detected in policy for relation "circle_members"
--
-- Every read of the table fails, so the whole Circles feature goes dark.
--
-- This project already solved that problem twice, in sql/10 and again in
-- sql/61, with is_circle_member(): a SECURITY DEFINER function, which runs as
-- its owner and is therefore NOT re-filtered by the policy, so the loop cannot
-- form. I did not use it, and reintroduced the exact bug those two files exist
-- to fix.
--
-- A SECOND, QUIETER PROBLEM. My policy was named circle_members_sel and the
-- existing one is named "members read same circle". `drop policy if exists
-- circle_members_sel` therefore dropped nothing, and both policies ended up on
-- the table. Postgres ORs permissive policies together, so the broken one had
-- to be evaluated on every read regardless of the good one succeeding.
--
-- THE ACTUAL GOAL, which was sound: a removed member must not keep reading the
-- circle through their tombstoned row. That belongs inside the helper, where it
-- is expressed once and every policy inherits it.
--
-- Idempotent. Safe to run twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. REMOVE THE RECURSIVE POLICY
-- ---------------------------------------------------------------------------
drop policy if exists circle_members_sel on circle_members;

-- ---------------------------------------------------------------------------
-- 2. TEACH THE HELPER ABOUT SOFT DELETES
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER is what makes this safe to call from a policy on the very
-- table it queries: it executes as the function owner, so RLS is not applied
-- again inside it and there is no loop.
--
-- STABLE lets the planner call it once per query rather than once per row,
-- which matters because it runs on every row of every circle read.
create or replace function public.is_circle_member(c uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from circle_members m
    where m.circle_id = c
      and m.user_id = auth.uid()
      and m.deleted_at is null   -- the sql/84 intent, in the right place
  );
$$;

grant execute on function public.is_circle_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RESTORE THE WORKING READ POLICY
-- ---------------------------------------------------------------------------
-- Same shape sql/10 and sql/61 used, plus the tombstone rule on the row being
-- read. Two separate conditions, and both are needed:
--
--   deleted_at is null        -- do not hand back tombstones as if they were
--                                live members
--   is_circle_member(...)     -- and only to somebody still in that circle
drop policy if exists "members read same circle" on circle_members;
create policy "members read same circle"
  on circle_members for select
  to authenticated
  using (
    deleted_at is null
    and (user_id = auth.uid() or public.is_circle_member(circle_id))
  );

-- ---------------------------------------------------------------------------
-- 4. WRITE POLICIES: DO NOT LET A TOMBSTONE GRANT RIGHTS
-- ---------------------------------------------------------------------------
-- The insert and delete policies from sql/10 predate deleted_at. They check
-- circles.owner_id, which is unaffected, so they were never recursive and are
-- restated here only to add the tombstone rule to the self-service branch.
drop policy if exists "members insert self or owner" on circle_members;
create policy "members insert self or owner"
  on circle_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

drop policy if exists "members leave self" on circle_members;
create policy "members leave self"
  on circle_members for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- A member updating their own row must not be able to resurrect themselves by
-- clearing deleted_at. Removal goes through circle_remove_member(), which
-- checks the caller's role; this policy only covers ordinary self-updates.
drop policy if exists "members update self" on circle_members;
create policy "members update self"
  on circle_members for update
  to authenticated
  using (deleted_at is null and auth.uid() = user_id)
  with check (deleted_at is null and auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare
  n_policies int;
  recursive_left int;
  helper_ok boolean;
begin
  select count(*) into n_policies
  from pg_policies where tablename = 'circle_members';

  -- Any remaining policy whose expression reads circle_members directly is a
  -- recursion waiting to happen.
  select count(*) into recursive_left
  from pg_policies
  where tablename = 'circle_members'
    and coalesce(qual, '') || coalesce(with_check, '') like '%circle_members%';

  select prosrc like '%deleted_at is null%' into helper_ok
  from pg_proc where proname = 'is_circle_member' limit 1;

  raise notice E'\npolicies on circle_members : %\nself-referencing policies  : % (must be 0)\nis_circle_member honours soft delete : %',
    n_policies, recursive_left, coalesce(helper_ok, false);

  if recursive_left > 0 then
    raise exception 'a policy on circle_members still reads circle_members directly; recursion will return';
  end if;
end $$;
