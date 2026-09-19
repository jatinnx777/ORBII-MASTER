-- 131_circles_insert_repair.sql
-- ============================================================================
-- HOTFIX. Nobody can create a circle.
--
--   new row violates row-level security policy for table "circles"
--
-- That is 42501 on INSERT into circles, and it is failing for every account
-- including the owner's, which rules out anything user-specific.
--
-- WHAT IT IS. Postgres denies by default: a table with RLS enabled and no
-- permissive INSERT policy rejects every insert, and the message is exactly the
-- one above. Both sql/44 and sql/61 DROP "circles insert self" before
-- recreating it, so a run that stopped in between, or a later edit that dropped
-- it without restoring it, leaves the table with RLS on and nothing allowing an
-- insert. Reads keep working, which is why only creation broke.
--
-- WHAT THIS DOES, AND DELIBERATELY DOES NOT DO. It restores the one policy that
-- is missing, exactly as sql/61 defined it. It does not touch circle_members,
-- circle_invites, or the read policies. Those are working, and circle_members
-- in particular is where the 42P17 recursion bug lives (sql/10, 61, 84, 85);
-- rewriting it during an incident to fix an unrelated table is how a small
-- outage becomes a total one.
--
-- WHY with check (auth.uid() = owner_id) IS THE WHOLE RULE. You may create a
-- circle you own, and nothing else. The app sends owner_id from the session, so
-- a caller cannot create a circle in somebody else's name. The owner is added
-- to circle_members by the circles_add_owner trigger (sql/44) in the same
-- transaction, so no second insert is needed here.
--
-- Idempotent. Safe to run twice. Run any time.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. WHAT WAS THERE BEFORE. Printed so the incident has a record.
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
  from pg_policies
  where schemaname = 'public' and tablename = 'circles' and cmd = 'INSERT';

  if n = 0 then
    raise notice 'BEFORE: circles had NO insert policy. This was the outage.';
  else
    raise notice 'BEFORE: circles already had % insert policy/policies. Recreating to the known-good definition.', n;
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- 1. RESTORE THE POLICY
-- ---------------------------------------------------------------------------
alter table public.circles enable row level security;

drop policy if exists "circles insert self" on public.circles;
create policy "circles insert self"
  on public.circles for insert to authenticated
  with check (auth.uid() = owner_id);

-- The table grant is separate from the policy and just as able to block an
-- insert, with a different message ("permission denied for table"). Asserted
-- here so a second cause cannot hide behind the first.
grant select, insert, update, delete on table public.circles to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select
  'an insert policy exists on circles (must be true)' as check,
  (exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'circles' and cmd = 'INSERT'
  ))::text as result
union all
select
  'it checks owner_id against auth.uid (must be true)',
  (exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'circles'
      and cmd = 'INSERT'
      and coalesce(with_check, '') ~* 'owner_id'
      and coalesce(with_check, '') ~* 'uid'
  ))::text
union all
select
  'authenticated can insert into circles (must be true)',
  has_table_privilege('authenticated', 'public.circles', 'INSERT')::text
union all
select
  'rls is still enabled on circles (must be true)',
  (select relrowsecurity::text from pg_class where oid = 'public.circles'::regclass);
