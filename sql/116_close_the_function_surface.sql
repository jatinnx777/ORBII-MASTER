-- 116_close_the_function_surface.sql
-- ============================================================================
-- Every function in the public schema was executable by anon. This closes it.
--
-- WHY THE SWEEP IN sql/115 FOUND 130 FUNCTIONS. Postgres grants EXECUTE on a
-- new function to PUBLIC by default. PUBLIC is not a role you can see in a
-- role list, it is "everyone, including roles that do not exist yet", and both
-- anon and authenticated inherit from it. A `grant execute ... to
-- authenticated` on a function that still carries the PUBLIC default grants
-- nothing: the caller already had it.
--
-- CORRECTION, because the first version of this comment said the repo had
-- never got this right and that is not true. 88 lines across 41 sql files do
-- revoke from public before granting, correctly, going back to sql/18. The
-- problem was never that the pattern was unknown. It was applied to some
-- functions and not others, with no check that would notice the difference,
-- which is worse than not knowing: it looks handled. The 130 that stayed open
-- are the ones nobody happened to write the line for.
--
-- WHY `REVOKE ... FROM anon` DID NOT WORK. Revoking from anon removes a grant
-- held BY anon. The grant here is held by PUBLIC. Revoking from anon when the
-- privilege comes from PUBLIC removes nothing and reports no error, which is
-- the worst possible combination: it looks like it worked. Re-running the
-- sweep after it returns the same 130 rows. The word that matters is `public`.
--
-- WHY THIS IS NOT `REVOKE ON ALL FUNCTIONS IN SCHEMA public FROM public`.
-- That one line is correct and would break the entire product in about four
-- ways at once:
--
--   1. service_role holds most of its privileges through PUBLIC too. Revoking
--      PUBLIC silently breaks notify-sos, drain-push, escalate-sos and every
--      other edge function, which is to say it breaks the SOS pipeline.
--   2. authenticated is in the same position, so the app loses all 79 of its
--      RPCs.
--   3. PostGIS lives in the public schema on Supabase. Its functions would be
--      caught in the same net.
--   4. RLS policies call functions (shares_circle_with, is_circle_member,
--      orbii_can_access_sos). A policy's function runs as the QUERYING role,
--      not the definer, so revoking those from authenticated makes every
--      policy that uses them throw, and the app sees empty tables everywhere.
--
-- So the revoke is surgical: PUBLIC and anon lose everything, then the roles
-- that actually need each function get it back by name.
--
-- WHAT WAS ACTUALLY EXPOSED. Nothing anonymous, as far as this can be checked:
-- the SECURITY DEFINER functions are gated on auth.uid(), which is null for
-- anon, so the predicates matched nothing. The exposure that mattered was to
-- `authenticated`, and it is listed in the audit at the bottom. push_enqueue is
-- the one to read first.
--
-- Idempotent. Safe to re-run. Run after sql/115.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- WHAT ONLY THE SERVER MAY CALL
-- ---------------------------------------------------------------------------
-- These are called by edge functions and pg_cron, never by a phone. Leaving
-- them open to authenticated is not a theoretical problem:
--
--   push_enqueue(tokens[], payload, priority) lets any signed-in account send
--   any push notification to any device token it can obtain. On a safety app
--   that is a fake "HELP IS COMING" delivered to a real person.
--
--   dispatch_verified_helpers / dispatch_community_helpers / next_wave_helpers
--   return helper identities and positions for arbitrary coordinates. That is
--   a map of every verified responder in the country, one query at a time.
--
--   compute_fraud_score and is_reward_eligible decide who gets paid.
--
-- is_admin is deliberately NOT in this list. It reads as though it belongs
-- here, but boolean helpers like it get called from inside RLS policies, where
-- they execute as the querying role. Revoking it from authenticated would make
-- every policy that calls it throw. It only reports on the caller, so leaving
-- it reachable costs nothing.
-- Declared inside the DO block below rather than as a temp table, because a
-- temp table would depend on the SQL editor wrapping the whole file in one
-- transaction, and it does not always.


-- ---------------------------------------------------------------------------
-- THE REVOKE, AND THE GRANTS BACK
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n_closed  int := 0;
  n_app     int := 0;
  n_server  int := 0;
  n_trigger int := 0;
  n_policy  int := 0;
  policy_fns text[];
  server_only text[] := array[
    'bdsm_features', 'bdsm_overlap', 'bdsm_score_all',
    'community_apply_scores', 'community_autohide', 'community_rating_matrix',
    'compute_fraud_score', 'is_reward_eligible',
    'dispatch_community_helpers', 'dispatch_verified_helpers', 'next_wave_helpers',
    'function_errors_sweep', 'log_function_error',
    'push_claim', 'push_enqueue', 'push_mark_failed', 'push_mark_sent',
    'push_outbox_alarm', 'push_outbox_health', 'push_outbox_sweep',
    'rate_limit_sweep', 'rls_auto_enable', 'sos_escalation_tick'
  ];
begin
  -- Collect every function name mentioned in an RLS policy expression. These
  -- run as the querying role, so authenticated must keep them whatever else
  -- happens. This is computed rather than hardcoded because the list changes
  -- every time a policy is written, and a hardcoded copy of it would be wrong
  -- within a month.
  select coalesce(array_agg(distinct p.proname), '{}')
    into policy_fns
  from pg_policy pol
  join pg_proc p on p.pronamespace = 'public'::regnamespace
  where pg_get_expr(pol.polqual, pol.polrelid, true) like '%' || p.proname || '%'
     or pg_get_expr(pol.polwithcheck, pol.polrelid, true) like '%' || p.proname || '%';

  for r in
    select p.oid::regprocedure as sig,
           p.proname,
           p.prorettype = 'trigger'::regtype as is_trigger
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      -- Extension-owned functions are left exactly as the extension shipped
      -- them. PostGIS is installed into public on Supabase and its grants are
      -- not ORBII's to rewrite.
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    n_closed := n_closed + 1;

    if r.is_trigger then
      -- A trigger function needs no grant at all. Postgres checks EXECUTE when
      -- the trigger is CREATED, not when it fires, so the trigger keeps
      -- working and nobody can call it by hand. Calling one directly only ever
      -- raised "trigger functions can only be called as triggers" anyway, so
      -- nothing is lost and one more name disappears from the API surface.
      n_trigger := n_trigger + 1;

    elsif r.proname = any(policy_fns) then
      -- Used by an RLS policy. authenticated must keep it or the policy throws
      -- and the table reads as empty.
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
      n_policy := n_policy + 1;

    elsif r.proname = any(server_only) then
      execute format('grant execute on function %s to service_role', r.sig);
      n_server := n_server + 1;

    else
      -- Everything the app, the admin page and the ambassador page call.
      -- service_role is included because edge functions legitimately act on a
      -- user's behalf and losing it there breaks the SOS pipeline silently.
      execute format('grant execute on function %s to authenticated, service_role', r.sig);
      n_app := n_app + 1;
    end if;
  end loop;

  raise notice 'closed to anon: %  |  app+server: %  |  server only: %  |  rls policy: %  |  triggers (no grant): %',
    n_closed, n_app, n_server, n_policy, n_trigger;
end $$;


-- ---------------------------------------------------------------------------
-- AND FOR EVERY FUNCTION WRITTEN FROM NOW ON
-- ---------------------------------------------------------------------------
-- Without this, the next sql file re-opens the hole for whatever it creates,
-- and this whole exercise repeats in three months.
--
-- READ THIS BEFORE WRITING sql/117. From here on a new function is executable
-- by NOBODY until it is granted. A missing grant surfaces in the app as
-- "function does not exist" or a silent 404 from PostgREST, not as a
-- permission error, so it looks like a typo in the RPC name. Every future sql
-- file must end with an explicit `grant execute ... to authenticated` or
-- `to service_role`. The last verify block below catches it if one is missed.
alter default privileges in schema public revoke execute on functions from public;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- has_function_privilege() with a text signature THROWS if the function does
-- not exist, which would abort the whole verify block over one renamed
-- argument. to_regprocedure() returns null instead, so a missing function
-- reports itself as missing rather than taking the other seven checks with it.
create or replace function public.orbii_can_exec(p_role text, p_sig text)
returns text language sql stable as $$
  select case
    when to_regprocedure(p_sig) is null then 'FUNCTION NOT FOUND'
    else has_function_privilege(p_role, to_regprocedure(p_sig), 'execute')::text
  end;
$$;

-- The helper follows the rule it exists to check, and does so here rather than
-- at the end of the file so it is not reported by the unreachable-function
-- audit below.
revoke all on function public.orbii_can_exec(text, text) from public, anon;
grant execute on function public.orbii_can_exec(text, text) to authenticated, service_role;

select 'functions anon can still execute (must be 0)' as check,
       count(*)::text as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and has_function_privilege('anon', p.oid, 'execute')
union all
-- The admin panel on the website signs in as an ordinary user, so if the
-- earlier "revoke admin functions from authenticated" advice had taken effect
-- it would have broken helper approval. This confirms it is reachable again.
select 'admin panel can still approve helpers (must be true)',
       public.orbii_can_exec('authenticated', 'public.admin_approve_helper(uuid)')
union all
select 'app can still read trails (must be true)',
       public.orbii_can_exec('authenticated', 'public.circle_member_trail(uuid,int)')
union all
select 'app can still find nearby helpers (must be true)',
       public.orbii_can_exec('authenticated',
         'public.nearest_helpers(double precision,double precision,double precision,integer)')
union all
select 'edge functions can still queue push (must be true)',
       public.orbii_can_exec('service_role', 'public.push_enqueue(text[],jsonb,smallint)')
union all
-- The two that were actually worth closing.
select 'a signed-in user can no longer send arbitrary push (must be false)',
       public.orbii_can_exec('authenticated', 'public.push_enqueue(text[],jsonb,smallint)')
union all
select 'a signed-in user can no longer map verified helpers (must be false)',
       public.orbii_can_exec('authenticated',
         'public.dispatch_verified_helpers(double precision,double precision,double precision,uuid)');


-- ---------------------------------------------------------------------------
-- AUDIT 1: ADMIN FUNCTIONS THAT DO NOT CHECK WHO IS CALLING
-- ---------------------------------------------------------------------------
-- Grants cannot solve this one. Every admin function is reachable by
-- authenticated, because ORBII admins ARE ordinary signed-in users: there is no
-- separate Postgres role for them, and the advice to "revoke admin functions
-- from authenticated" would have locked the admin out of the admin panel along
-- with everybody else.
--
-- So the only thing standing between a signed-in stranger and admin_approve_
-- helper is a check inside the function body. Anything reported as NO GUARD
-- below is a function any account can call today. admin_approve_helper without
-- a guard means anyone can approve themselves as a verified responder.
--
-- These functions are not in sql/, they were created in the dashboard, so this
-- reads the live bodies rather than the repo.
select p.proname as admin_function,
       case
         when p.prosrc ~* 'am_i_admin|is_admin|is_orbii_admin|admin_only|raise exception'
           then 'guarded'
         else '>>> NO GUARD <<<'
       end as caller_check,
       p.prosecdef as security_definer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and (p.proname like 'admin\_%' or p.proname like 'amb\_%')
order by caller_check, p.proname;


-- ---------------------------------------------------------------------------
-- AUDIT 2: FUNCTIONS NO ROLE CAN REACH
-- ---------------------------------------------------------------------------
-- Catches the footgun the default-privileges change above introduces, and any
-- function that was already orphaned. A non-trigger function here is either
-- dead code or an RPC the app is about to fail on.
select p.oid::regprocedure::text as unreachable_function
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and p.prorettype <> 'trigger'::regtype
  and not has_function_privilege('authenticated', p.oid, 'execute')
  and not has_function_privilege('service_role', p.oid, 'execute')
order by 1;
