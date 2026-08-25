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
-- Prints every policy on circle_members with its expression, then fails only on
-- a GENUINE self-reference.
--
-- The first version of this check flagged any policy whose expression contained
-- the string 'circle_members', and raised on its own first run. That was too
-- blunt: Postgres renders a qualified column as `circle_members.circle_id`, so
-- a perfectly safe policy matches the substring. Only a subquery that SELECTs
-- FROM or JOINs the table recurses, so that is what is tested now.
do $$
declare
  r record;
  bad int := 0;
  helper_ok boolean;
begin
  raise notice '--- policies on circle_members ---';
  for r in
    select policyname, cmd, coalesce(qual, '') as q, coalesce(with_check, '') as w
    from pg_policies
    where tablename = 'circle_members'
    order by cmd, policyname
  loop
    raise notice '  [%] %  USING: %  CHECK: %',
      r.cmd, r.policyname,
      coalesce(nullif(r.q, ''), '(none)'),
      coalesce(nullif(r.w, ''), '(none)');

    -- Recursion requires reading the table, not merely naming a column of it.
    if (r.q || ' ' || r.w) ~* '(from|join)\s+(public\.)?circle_members' then
      bad := bad + 1;
      raise notice E'      ^^ SELF-REFERENCING: this policy reads circle_members';
    end if;
  end loop;

  select prosrc like '%deleted_at is null%' into helper_ok
  from pg_proc where proname = 'is_circle_member' limit 1;

  raise notice 'is_circle_member honours soft delete : %', coalesce(helper_ok, false);
  raise notice E'self-referencing policies           : %', bad;

  if bad > 0 then
    raise exception
      'A policy on circle_members still SELECTs FROM circle_members; that recurses (42P17). See the notices above for which one.';
  end if;
end $$;
