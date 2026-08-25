-- 87_hotfix_circle_visits_revoke.sql
-- ============================================================================
-- IMMEDIATE MITIGATION. Run this first, on its own, right now.
--
-- The version of circle_visits() that went out with sql/86 is SECURITY DEFINER
-- with no caller predicate. DEFINER bypasses RLS, so any authenticated user
-- calling circle_visits(200) receives the 200 most recent visits of EVERY user
-- in the database: name, zone label, arrival and departure times.
--
-- This revokes the grant. That kills the exposure in one statement and does not
-- depend on the rest of sql/86 applying cleanly.
--
-- SAFE FOR THE APP. loadVisits() in src/services/geofence.ts returns [] on any
-- error, and HomeScreen swallows it. The Recent Activity card renders empty
-- until the fixed sql/86 is applied. Nothing crashes.
-- ============================================================================

revoke execute on function public.circle_visits(int) from authenticated, anon, public;

do $$
begin
  if exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.circle_visits(int)')
      and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
  ) then
    raise exception 'STILL EXPOSED: authenticated can execute the definer version.';
  end if;
  raise notice 'circle_visits is no longer callable by clients. Now run sql/86.';
end $$;
