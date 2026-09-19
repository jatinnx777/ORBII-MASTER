-- circles_truth.sql
-- ============================================================================
-- ONE query, because the Supabase SQL editor renders only the LAST result set
-- and silently drops the rest.
--
-- The probe proved the request is authenticated and auth.uid() = owner_id, so
-- the insert's own `with check` cannot be what rejects it. The remaining
-- suspects are all visible here:
--
--   A. the SELECT policy, which PostgreSQL also applies to the row returned
--      by INSERT ... RETURNING (which is what .select('*') makes PostgREST
--      send). At that instant the owner is not yet in circle_members, because
--      the trigger that adds them fires at the END of the statement.
--   B. a RESTRICTIVE policy, which is ANDed with everything and can veto on
--      its own.
--   C. a BEFORE trigger firing after my probe and rewriting owner_id.
--
-- Read only.
-- ============================================================================

select
  'A. policy' as section,
  policyname || '  [' || cmd || ' / ' || permissive || ' / ' || roles::text || ']' as object,
  coalesce(qual, '(no using)')            as using_expr,
  coalesce(with_check, '(no with check)') as with_check_expr
from pg_policies
where schemaname = 'public' and tablename = 'circles'

union all

select
  'B. trigger',
  t.tgname || '  ['
    || case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end || ' '
    || case when (t.tgtype & 4)  <> 0 then 'INSERT'
            when (t.tgtype & 16) <> 0 then 'UPDATE'
            when (t.tgtype & 8)  <> 0 then 'DELETE'
            else 'other' end || ']',
  p.proname || case when p.prosecdef then '  (SECURITY DEFINER)' else '  (invoker)' end,
  case t.tgenabled when 'O' then 'enabled'
                   when 'D' then 'DISABLED'
                   else t.tgenabled::text end
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'public.circles'::regclass
  and not t.tgisinternal

union all

select
  'C. table flags',
  'circles',
  'rls_enabled = ' || relrowsecurity::text,
  'rls_forced = '  || relforcerowsecurity::text
from pg_class
where oid = 'public.circles'::regclass

order by 1, 2;
