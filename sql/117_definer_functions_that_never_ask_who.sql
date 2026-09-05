-- 117_definer_functions_that_never_ask_who.sql
-- ============================================================================
-- The sql/116 audit came back clean on the part that mattered: all 36 admin_*
-- functions are guarded. This closes the one real finding and then asks a
-- better question than 116 did.
--
-- WHAT 116 GOT WRONG. Its audit selected on the name prefix admin_ and amb_,
-- and tested for a caller check by grepping the body. That produced seven
-- false alarms and, much worse, could not have found a single true one outside
-- those two prefixes.
--
-- Six of the seven were amb_rate_paise, amb_milestones, amb_clearing_days,
-- amb_max_per_device, amb_min_withdrawal_paise and amb_require_circle_member:
-- no arguments, SECURITY INVOKER, returning a constant. They are the same
-- shape as orbii_trail_days() in sql/115. A function that takes nothing and
-- returns a published number has nobody to check. Flagging them was noise, and
-- noise in a security audit is not harmless: it trains you to skim the output.
--
-- THE SEVENTH WAS REAL, and small. amb_identity_verified(uuid) is SECURITY
-- DEFINER because it reads auth.users, which authenticated cannot. Any
-- signed-in account could pass a uuid and learn whether it belonged to a
-- confirmed user. That is a user-existence oracle. It is a weak one, since
-- uuids are not guessable and you mostly only hold the ones already in your
-- circle, but it is a question the caller had no business being able to ask.
--
-- All five of its callers are inside ambassador_activation_sweep() and
-- admin_referral_blockers(), both SECURITY DEFINER, so the inner call already
-- runs as the definer. authenticated never needed the grant.
--
-- Idempotent. Run after sql/116.
-- ============================================================================

revoke all on function public.amb_identity_verified(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- THE BETTER QUESTION
-- ---------------------------------------------------------------------------
-- A SECURITY DEFINER function runs with the owner's rights. RLS does not apply
-- to it. The ONLY thing standing between a signed-in stranger and every row it
-- touches is a check written inside the body.
--
-- So the test is not "is this named admin". The test is:
--
--   Does this function run as the owner, is it reachable by authenticated,
--   does it write, and does its body ever mention auth.uid()?
--
-- A function that answers yes, yes, yes, no is by construction acting on
-- behalf of a caller it never identified. That is the actual shape of the bug,
-- and it does not care what the function is called.
--
-- Reading the RESULT column:
--
--   REVIEW: writes, and never asks who is calling. Not automatically a bug.
--   It may take no user-supplied target (a sweep), or it may check via a
--   helper this cannot see through. But each one needs a human to say which.
--
--   ok: identifies the caller, or does not write.
--
-- The p_uid/p_user/p_target column is the one to sort by. A function that
-- writes, never mentions auth.uid(), AND accepts a user id as an argument is
-- being handed both the target and the trust by whoever calls it.
select p.proname as fn,
       pg_get_function_identity_arguments(p.oid) as args,
       case
         when p.prosrc !~* '\minsert\M|\mupdate\M|\mdelete\M' then 'ok (read only)'
         when p.prosrc ~* 'auth\.uid\(\)' then 'ok (identifies caller)'
         when p.prosrc ~* 'am_i_admin|is_admin' then 'ok (admin gate)'
         else '>>> REVIEW: writes, never asks who <<<'
       end as result,
       (pg_get_function_identity_arguments(p.oid) ~* '(uuid|p_user|p_uid|p_target|p_helper)')
         as takes_a_target
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.prosecdef
  and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('authenticated', p.oid, 'execute')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
order by (case
            when p.prosrc !~* '\minsert\M|\mupdate\M|\mdelete\M' then 2
            when p.prosrc ~* 'auth\.uid\(\)|am_i_admin|is_admin' then 2
            else 1
          end),
         (pg_get_function_identity_arguments(p.oid) ~* '(uuid|p_user|p_uid|p_target|p_helper)') desc,
         p.proname;


-- ---------------------------------------------------------------------------
-- THE THREE POSTGIS ROWS SQL/115 STILL REPORTS
-- ---------------------------------------------------------------------------
-- 116 took the anon-executable count from 130 to 3, and the three left are
-- st_estimatedextent, which it skipped on purpose: extension-owned functions
-- are left as the extension shipped them, and a PostGIS upgrade would restore
-- anything changed here anyway.
--
-- They are SECURITY DEFINER, so an anon caller could in principle ask for the
-- bounding box of a geometry column without holding any permission on the
-- table behind it. On a helper-location table that would be a box drawn around
-- every responder in the country, which with few responders is a box drawn
-- around a neighbourhood.
--
-- It reports nothing here, because ORBII has no geometry columns: nearest_
-- helpers does its own arithmetic. So the exception stands and nothing is
-- revoked.
--
-- BUT the repo is not proof of the live schema. The admin_ functions were
-- created in the dashboard and appear in no sql file, and a geometry column
-- could have been added the same way. This asks the database instead of the
-- repo. Any row here means the paragraph above is wrong and the grant needs
-- revisiting.
select c.relname as table_with_geometry,
       a.attname as column_name,
       format_type(a.atttypid, a.atttypmod) as type
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and a.attnum > 0
  and not a.attisdropped
  and format_type(a.atttypid, a.atttypmod) ~* '^(geometry|geography)'
order by 1, 2;


-- ---------------------------------------------------------------------------
-- RE-VERIFY, because 116's own output was never read back
-- ---------------------------------------------------------------------------
select 'anon can execute nothing (must be 0)' as check,
       count(*)::text as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('anon', p.oid, 'execute')
union all
select 'the auth.users oracle is closed (must be false)',
       public.orbii_can_exec('authenticated', 'public.amb_identity_verified(uuid)')
union all
-- Spelled with its argument. The website calls this as rpc('ambassador_summary')
-- with no parameters, which reads like a zero-argument function, but the
-- parameter has a DEFAULT. to_regprocedure matches on declared arguments, not
-- on how few you can get away with passing, so 'ambassador_summary()' resolves
-- to nothing and the check reported FUNCTION NOT FOUND for a function that was
-- there the whole time.
select 'ambassador page still works (must be true)',
       public.orbii_can_exec('authenticated', 'public.ambassador_summary(uuid)')
union all
select 'admin panel still works (must be true)',
       public.orbii_can_exec('authenticated', 'public.admin_approve_helper(uuid)')
union all
select 'app can still send an SOS (must be true)',
       public.orbii_can_exec('authenticated', 'public.orbii_can_access_sos(uuid)')
union all
select 'the sweep still runs as the server (must be true)',
       public.orbii_can_exec('service_role', 'public.sos_escalation_tick()')
union all
select 'no function is stranded with no role (must be 0)',
       (select count(*)::text
        from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.prorettype <> 'trigger'::regtype
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
          and not has_function_privilege('authenticated', p.oid, 'execute')
          and not has_function_privilege('service_role', p.oid, 'execute')
          and p.proname <> 'amb_identity_verified');
