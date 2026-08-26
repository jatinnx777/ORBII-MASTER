-- 93_security_hardening.sql
-- ============================================================================
-- One real vulnerability, closed. Plus an audit that finds the rest.
--
-- READ THIS BEFORE RUNNING. Most of the brief for this file was already done in
-- sql/86 and sql/88, and re-doing it would churn working policies for nothing:
--
--   circle_visits        SECURITY INVOKER since sql/86. RLS applies again.
--   shares_circle_with   honours deleted_at since sql/86 section 3c.
--   realtime soft-delete orbii_can_access_sos honours deleted_at since sql/88.
--   circle_locations     already gates on shares_circle_with, so it inherited
--                        the soft-delete fix for free. Nothing to do.
--
-- What this file does NOT do is "enforce strict RLS across all base tables" as
-- a sweep. 63 tables carry RLS today. Rewriting policies for tables nobody has
-- read is how you lock every user out of her own circle on a Tuesday night. The
-- audit at the bottom lists what is actually exposed, and then we fix those on
-- purpose, one at a time, with a reason written down.
--
-- Idempotent. Run after sql/89.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. DENIAL OF RESCUE
-- ---------------------------------------------------------------------------
-- THE BUG. sos_responders has carried this policy since sql/31:
--
--   create policy "sosr insert own" on sos_responders for insert
--     to authenticated with check (auth.uid() = user_id);
--
-- It constrains WHO you claim to be. It says nothing about WHICH SOS you are
-- joining. Any authenticated account can insert itself onto any sos_id it can
-- name, and sos ids travel in push payloads and broadcast beacons.
--
-- Until last week that was cosmetic: a stranger appeared on the victim's
-- responder list and nobody was worse off.
--
-- SQL/89 MADE IT A WEAPON, AND THAT ONE IS MINE. The wave cap means three live
-- responders is full. Three colluding accounts, or one person with three
-- logins, can now take all three slots on a real emergency in the seconds after
-- it fires. Every genuine helper who taps Accept is then told, correctly and
-- politely, that enough people are already on their way. The victim's screen
-- says three are coming. Nobody is coming.
--
-- A cap is a scarce resource, and a scarce resource that anyone can claim
-- without proof is a denial-of-service against the thing it was protecting.
--
-- THE FIX. Direct INSERT is revoked. accept_sos_dispatch (sql/89) becomes the
-- only way in, and it already checks that the SOS exists, that it is still
-- active, that the caller is not the victim, and takes a row lock while it
-- counts. The client stopped inserting directly in commit 05ac82a, so nothing
-- shipping breaks.
--
-- The policy is replaced rather than left in place. A policy that permits an
-- action the grant forbids is a trap for whoever restores the grant later.
revoke insert on sos_responders from authenticated, anon;

drop policy if exists "sosr insert own" on sos_responders;

-- Kept as a deliberate deny, not an absence. An absent policy under RLS also
-- denies, but silently, and the next person to read this table cannot tell
-- whether that was a decision or an oversight.
create policy "sosr insert via rpc only"
  on sos_responders for insert
  to authenticated
  with check (false);

comment on table sos_responders is
  'Write ONLY through accept_sos_dispatch() / drop_sos_dispatch(). Direct insert '
  'is revoked: the old policy checked user_id but not sos_id, so anyone could '
  'occupy the capped responder slots on somebody else''s emergency.';

-- Reads stay open to the two parties who need them, unchanged from sql/31.
-- Re-stated so this file is a complete description of the table's access.
drop policy if exists "sosr read own or victim" on sos_responders;
create policy "sosr read own or victim"
  on sos_responders for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from sos_events e
      where e.id::text = sos_responders.sos_id and e.user_id = auth.uid()
    )
  );

-- UPDATE and DELETE were never granted and are not granted now. Leaving is
-- handled by drop_sos_dispatch, which sets left_at as SECURITY DEFINER. If a
-- client could UPDATE this table it could clear its own left_at and reoccupy a
-- slot it had given up.
revoke update, delete on sos_responders from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 2. THE SAME SHAPE, CHECKED ELSEWHERE
-- ---------------------------------------------------------------------------
-- Only three tables in this schema grant a write directly to clients. The other
-- two are telemetry sinks and are fine, but the reasoning is recorded here so
-- nobody has to re-derive it:
--
--   client_errors  insert to anon+authenticated. Append-only crash reports. No
--                  read policy, so a client cannot read back what it wrote and
--                  cannot enumerate anyone else's. Worst case is junk rows.
--   app_events     same shape, same reasoning.
--
-- Neither gates access to anything, so neither can be used to take something
-- away from a person in trouble. That is the test that matters, not whether a
-- table can be written to.

-- ---------------------------------------------------------------------------
-- 3. AUDIT: WHAT IS ACTUALLY EXPOSED
-- ---------------------------------------------------------------------------
-- Read-only. Returns rows rather than raising notices, because the Supabase
-- editor hides the Notices pane and every verify block written before
-- sql/checks/health.sql reported into a void.
--
-- Three findings, in descending order of how bad they are:
--
--   NO RLS          the table is readable and writable by anyone with the anon
--                   key, which ships inside the APK. This is the one to fix
--                   today.
--   RLS, NO POLICY  RLS is on and no policy exists, so everything is denied.
--                   Safe, but it means a feature is quietly broken and nobody
--                   has noticed, which on this product is its own bug class.
--   DIRECT WRITE    a client can INSERT, UPDATE or DELETE without going through
--                   a function. Sometimes correct. Always worth justifying.
create or replace view public.security_audit as
select
  c.relname::text as table_name,
  case
    when not c.relrowsecurity then 'NO RLS'
    when p.n_policies = 0 then 'RLS, NO POLICY'
    else 'ok'
  end as rls_status,
  coalesce(p.n_policies, 0)::int as policies,
  -- What a signed-in client can do to this table without any function in the
  -- way. has_table_privilege answers for the role, the policies then filter
  -- rows; both have to be wrong for a table to be genuinely open.
  concat_ws(
    ',',
    case when has_table_privilege('authenticated', c.oid, 'select') then 'select' end,
    case when has_table_privilege('authenticated', c.oid, 'insert') then 'insert' end,
    case when has_table_privilege('authenticated', c.oid, 'update') then 'update' end,
    case when has_table_privilege('authenticated', c.oid, 'delete') then 'delete' end
  ) as authenticated_can,
  concat_ws(
    ',',
    case when has_table_privilege('anon', c.oid, 'select') then 'select' end,
    case when has_table_privilege('anon', c.oid, 'insert') then 'insert' end,
    case when has_table_privilege('anon', c.oid, 'update') then 'update' end,
    case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end
  ) as anon_can
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join (
  select schemaname, tablename, count(*) as n_policies
  from pg_policies group by schemaname, tablename
) p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public'
  and c.relkind = 'r';

comment on view public.security_audit is
  'Read-only posture check. select * from security_audit where rls_status <> ''ok'' '
  'or anon_can <> '''';';

-- The view describes the security posture, so being able to read it tells an
-- attacker exactly which table to try. Service role and the SQL editor only.
revoke all on public.security_audit from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. VERIFY
-- ---------------------------------------------------------------------------
-- Returns rows. Run it, read it, do not assume "Success" meant anything.
select 'responder direct insert revoked' as check,
       (not has_table_privilege('authenticated', 'public.sos_responders', 'insert'))::text as result
union all
select 'responder update revoked',
       (not has_table_privilege('authenticated', 'public.sos_responders', 'update'))::text
union all
select 'accept rpc still present',
       (to_regprocedure('public.accept_sos_dispatch(text)') is not null)::text
union all
select 'circle_visits is INVOKER',
       coalesce((select (not prosecdef)::text from pg_proc
                 where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING')
union all
select 'shares_circle_with honours soft delete',
       coalesce((select (prosrc like '%deleted_at is null%')::text from pg_proc
                 where proname = 'shares_circle_with' limit 1), 'MISSING')
union all
select 'realtime authoriser honours soft delete',
       coalesce((select (prosrc like '%a.deleted_at is null%')::text from pg_proc
                 where proname = 'orbii_can_access_sos' limit 1), 'MISSING')
union all
select 'tables with NO RLS (want 0)',
       (select count(*)::text from public.security_audit where rls_status = 'NO RLS')
union all
-- CORRECTED. The first version of this line counted tables where anon holds a
-- write PRIVILEGE and expected 2. It returned 69, and 69 was right: Supabase
-- ships `grant all on all tables in schema public to anon, authenticated`, so
-- privilege is broad by design and RLS is what filters rows. Counting
-- privileges alone counts the wrong thing and produces a frightening number
-- that means nothing.
--
-- Exposure needs BOTH the privilege AND the absence of a row filter, so this
-- now counts policies that name anon or public on a write command. Those are
-- reachable by anybody holding the key shipped inside the APK, with no account.
select 'anon-writable POLICIES (want 0, telemetry uses grants not policies)',
       (select count(*)::text from pg_policies
        where schemaname = 'public'
          and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
          and ('anon' = any(roles) or 'public' = any(roles)));
