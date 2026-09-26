-- 150_report_a_helper.sql
-- ============================================================================
-- A way to report a helper that does not require having the app.
--
-- INCIDENT_POLICY.md lists this as required before the first real dispatch, and
-- the reason is specific. The people most likely to need to report a helper are
-- the people most likely to have deleted the app: somebody frightened by the
-- person who turned up does not keep the thing that sent him. An intake that
-- only exists inside the app is an intake that is closed to exactly the person
-- it is for.
--
-- ============================================================================
-- DESIGN, AND WHY EACH CHOICE IS THE CAUTIOUS ONE
-- ============================================================================
--
-- ANON CAN INSERT. She does not have to sign in, prove who she is, or still have
-- an account. Requiring authentication here would be requiring a victim to log
-- in to a product she associates with what happened to her.
--
-- NOBODY CAN READ IT. Not anon, not authenticated, not even the reporter. RLS is
-- on with an insert policy and no select policy, so the only way to read a
-- report is the service role. These rows are allegations about named people; a
-- table of them readable from a phone would be the worst leak this system could
-- have, worse than the location data, because it would expose both the accused
-- and the accuser.
--
-- ALMOST EVERY FIELD IS OPTIONAL. She may not know the helper's surname, may not
-- remember the date, may not want to leave her name. A form that refuses to
-- submit without those is a form that loses the report. Only the description is
-- required, because a report with no description is not a report.
--
-- NO EMAIL VERIFICATION, NO CAPTCHA, AND YES THIS CAN BE SPAMMED. That trade is
-- deliberate and it should be made with open eyes: a junk row costs somebody
-- five minutes of reading, and a barrier costs somebody a report. The mitigation
-- is length limits and a per-IP-less cap on nothing at all, plus a human reading
-- them. If it is abused, add a captcha then, not now.
--
-- SUSPENSION IS STILL A HUMAN DECISION. Nothing here touches
-- helper_profiles.verification_status. A row in this table must never
-- automatically suspend anybody, because then the form becomes a weapon:
-- anybody could remove any helper from the network anonymously. A person reads
-- it and decides, per INCIDENT_POLICY clause 2.
--
-- Idempotent. No transaction control.
-- ============================================================================

create table if not exists public.helper_reports (
  id           uuid primary key default gen_random_uuid(),

  -- What happened. The only required field.
  description  text not null check (length(btrim(description)) between 10 and 5000),

  -- Who, as well as she can say. Any of these may be null.
  helper_name  text check (helper_name is null or length(helper_name) <= 200),
  when_text    text check (when_text is null or length(when_text) <= 200),
  where_text   text check (where_text is null or length(where_text) <= 300),

  -- How to reach her, if she wants to be reached. Null is a complete answer.
  contact      text check (contact is null or length(contact) <= 200),

  -- Asked because the first thing to do with a report is check she is safe NOW,
  -- and knowing before anybody reads it changes what happens first.
  safe_now     boolean,

  -- Set by whoever handles it. 'new' until a person has looked.
  status       text not null default 'new'
                 check (status in ('new', 'reading', 'actioned', 'closed', 'junk')),
  handled_note text,

  created_at   timestamptz not null default now()
);

comment on table public.helper_reports is
  'Reports about a helper, submitted from the website without needing the app or an account. Insert-only for anon, readable only by the service role. A row here NEVER auto-suspends anybody: see INCIDENT_POLICY.md clause 2.';

create index if not exists helper_reports_status_idx
  on public.helper_reports (status, created_at desc);

alter table public.helper_reports enable row level security;

-- Insert only, and nothing else, for people who are not signed in.
revoke all on table public.helper_reports from anon, authenticated;
grant insert on table public.helper_reports to anon, authenticated;
grant select, insert, update, delete on table public.helper_reports to service_role;

drop policy if exists helper_reports_anyone_can_report on public.helper_reports;
create policy helper_reports_anyone_can_report
  on public.helper_reports for insert
  to anon, authenticated
  with check (
    -- status and handled_note are ours, not the reporter's. Without this a
    -- submission could arrive pre-marked 'junk' or 'closed' and never be read.
    status = 'new' and handled_note is null
  );

-- NO SELECT POLICY, DELIBERATELY. With RLS on and no select policy, nobody
-- reading through PostgREST can see a single row, including the person who
-- wrote it. Reports are read with the service role. Do not "fix" this by adding
-- a policy so the reporter can see their own; matching a reporter to a row
-- requires identifying her, which this form exists to avoid.


-- ---------------------------------------------------------------------------
-- Retention.
--
-- Two years. Long enough that a second report about the same person lands next
-- to the first, which is the pattern INCIDENT_POLICY clause 5 turns into a
-- permanent removal, and long enough to outlast a police process. Junk is
-- dropped after 30 days because it is not evidence of anything.
-- ---------------------------------------------------------------------------
create or replace function public.purge_helper_reports()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare n int := 0; m int := 0;
begin
  delete from helper_reports where status = 'junk' and created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from helper_reports where created_at < now() - interval '2 years';
  get diagnostics m = row_count;
  return n + m;
end $fn$;

revoke all on function public.purge_helper_reports() from public, anon, authenticated;
grant execute on function public.purge_helper_reports() to service_role;

do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('orbii-purge-helper-reports')
      where exists (select 1 from cron.job where jobname = 'orbii-purge-helper-reports');
    perform cron.schedule('orbii-purge-helper-reports', '50 4 * * *',
                          'select public.purge_helper_reports();');
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- Rows 2 and 3 are the ones that matter. If anon can SELECT from this table,
-- stop and fix it before the page goes live: it would publish allegations about
-- named people to anyone with the anon key, which ships in the app.
-- ---------------------------------------------------------------------------
select v.check, v.result
from (
  select 1 as ord, 'anyone can file a report (must be true)' as check,
         has_table_privilege('anon', 'public.helper_reports', 'insert')::text as result

  union all
  select 2, 'anon cannot read reports (must be false)',
         has_table_privilege('anon', 'public.helper_reports', 'select')::text

  union all
  select 3, 'signed-in users cannot read reports either (must be false)',
         has_table_privilege('authenticated', 'public.helper_reports', 'select')::text

  union all
  select 4, 'RLS is on (must be true)',
         (select relrowsecurity::text from pg_class
           where oid = to_regclass('public.helper_reports'))

  union all
  select 5, 'there is no select policy (must be 0)',
         (select count(*)::text from pg_policies
           where schemaname = 'public' and tablename = 'helper_reports'
             and cmd = 'SELECT')

  union all
  select 6, 'nothing here can suspend a helper (must be false)',
         (select (pg_get_functiondef(oid) like '%verification_status%')::text
            from pg_proc
           where proname = 'purge_helper_reports' and pronamespace = 'public'::regnamespace)

  union all
  select 7, 'retention scheduled (must be true)',
         (exists (select 1 from cron.job where jobname = 'orbii-purge-helper-reports'))::text

  union all
  select 8, 'reports waiting to be read',
         (select count(*)::text from helper_reports where status = 'new')
) v
order by v.ord;
