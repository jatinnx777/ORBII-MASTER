-- 146_incident_records_expire.sql
-- ============================================================================
-- Incident and arrival records stop being kept forever.
--
-- LEGAL_HELPER.md clause 4.2 promises a helper that the record of which
-- emergency they attended is kept for three years. Nothing enforced that. The
-- promise was not false yet only because the app is months old and no record is
-- near three years, which is the worst kind of compliance: true by accident and
-- getting less true every night.
--
-- The main app's PRIVACY_POLICY.md was weaker still. It said SOS records are
-- "retained as your safety history" with no period at all. Under the DPDP Act,
-- keeping personal data with no stated limit is the position that is hard to
-- defend, not the safe one. This gives both documents the same number.
--
-- ============================================================================
-- WHY CASCADES ARE NOT ENOUGH, WHICH IS THE WHOLE REASON THIS IS SUBTLE
-- ============================================================================
--
-- Deleting an sos_events row cascades into five tables. It also silently
-- misses four, because four tables carry an sos_id with NO foreign key:
--
--   sos_responders   sos_id is TEXT, no FK. sql/81 documents the split.
--   rescue_events    sos_id is uuid, no FK.
--   sos_escalation   sos_id is TEXT primary key, no FK (sql/78).
--   dispatch_decisions  no FK by design; already purged at 30 days (sql/144).
--
-- sos_responders and rescue_events are the arrival records clause 4.2 is
-- actually about. A purge that deleted only sos_events would have looked like
-- it worked, reported rows deleted, and left the helper's attendance history in
-- place indefinitely. So each of those is deleted explicitly.
--
-- EACH TABLE IS AGED ON ITS OWN TIMESTAMP, not on a join to sos_events. Two
-- reasons. It cannot break on the text/uuid split, and it also collects
-- orphans: rows whose sos_events parent is already gone, which a join would
-- never reach and which would otherwise live forever.
--
-- ============================================================================
-- WHAT IS DELIBERATELY KEPT
-- ============================================================================
--
-- coin_transactions. Its FK is `on delete set null`, so deleting the emergency
-- nulls the link and leaves the ledger row. That is correct and it is not an
-- oversight: the payout ledger is kept 8 years for the Income-tax Act, and a
-- coin movement with no sos_id still says a helper earned 200 coins on a date.
-- The money record survives; the record of whose emergency it was does not.
--
-- ============================================================================
-- Idempotent. No transaction control. Safe to run twice.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- The retention period, in one place.
--
-- In a function rather than inline so that the number appears once, the verify
-- below can print what is actually running, and changing it after counsel
-- settles clause 4.2 is a one-line edit instead of a search across a purge.
-- Same pattern as journey_overdue_grace() in sql/139.
-- ---------------------------------------------------------------------------
create or replace function public.incident_retention()
returns interval
language sql immutable set search_path = public as $fn$
  select interval '3 years';
$fn$;

comment on function public.incident_retention() is
  'How long incident and arrival records are kept. LEGAL_HELPER.md clause 4.2. Counsel to confirm the number.';


-- ---------------------------------------------------------------------------
-- The purge.
--
-- Returns one row per table with what it removed, rather than a single total.
-- A total of zero cannot tell you whether nothing was old enough or whether
-- the delete silently matched nothing, and this job runs unattended at 3am.
-- ---------------------------------------------------------------------------
create or replace function public.purge_incident_records()
returns table(source text, rows_deleted bigint)
language plpgsql security definer set search_path = public as $fn$
declare
  v_cutoff timestamptz := now() - public.incident_retention();
  n bigint;
begin
  -- Order matters only for readability; none of these blocks the next.
  -- The no-FK tables go first so that a failure part-way through leaves
  -- orphans rather than dangling parents.

  -- Arrival records: the helper attended this emergency. Clause 4.2.
  delete from sos_responders where created_at < v_cutoff;
  get diagnostics n = row_count;
  return query select 'sos_responders'::text, n;

  -- The richer arrival record: accept, movement, geofenced arrival, departure.
  delete from rescue_events where accepted_at < v_cutoff;
  get diagnostics n = row_count;
  return query select 'rescue_events'::text, n;

  -- Wave and victim-check state for an emergency long since over.
  delete from sos_escalation where last_wave_at < v_cutoff;
  get diagnostics n = row_count;
  return query select 'sos_escalation'::text, n;

  -- Last, and the one that cascades: sos_arrival_codes, helper_dispatches,
  -- sos_escalations, sos_verify_codes all go with it. coin_transactions does
  -- NOT; its sos_id is nulled and the ledger row stays.
  delete from sos_events where created_at < v_cutoff;
  get diagnostics n = row_count;
  return query select 'sos_events (and cascades)'::text, n;
end $fn$;

comment on function public.purge_incident_records() is
  'Deletes incident and arrival records past incident_retention(). Keeps the coin ledger. LEGAL_HELPER clause 4.2.';

-- Nobody calls this from a phone. Ever.
revoke all on function public.purge_incident_records() from public, anon, authenticated;
grant execute on function public.purge_incident_records() to service_role;


-- ---------------------------------------------------------------------------
-- Scheduled.
--
-- 04:10, after the document purge (02:41) and the dispatch-decision purge
-- (03:30), so the three never contend and the order in the logs matches the
-- order in the policy. Weekly would be enough for a three-year window, but
-- nightly means a missed night is caught the next night instead of the next
-- week, and it costs nothing when there is nothing to delete.
-- ---------------------------------------------------------------------------
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('orbii-purge-incident-records')
      where exists (select 1 from cron.job where jobname = 'orbii-purge-incident-records');
    perform cron.schedule('orbii-purge-incident-records', '10 4 * * *',
                          'select public.purge_incident_records();');
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- The last row is the important one and it is not a pass/fail. It lists every
-- table in the schema that carries an sos_id, so that the next person to add
-- one can see whether this purge knows about it. A migration that hard-codes a
-- list of tables is wrong the moment somebody adds the tenth table, and the
-- only defence is making the omission visible rather than invisible.
-- ---------------------------------------------------------------------------
-- Ordered by an explicit key, because a bare `order by 1` across a UNION would
-- sort the fixed checks alphabetically and make the grid unreadable. The table
-- listing sorts within its own block.
select v.check, v.result
from (
  select 1 as ord, 'retention period now enforced' as check,
         public.incident_retention()::text as result

  union all
  select 2, 'purge_incident_records exists (must be true)',
         (to_regprocedure('public.purge_incident_records()') is not null)::text

  union all
  select 3, 'it is SECURITY DEFINER (must be true)',
         (select prosecdef::text from pg_proc
           where proname = 'purge_incident_records' and pronamespace = 'public'::regnamespace)

  union all
  select 4, 'no client can execute it (must be false)',
         has_function_privilege('authenticated', 'public.purge_incident_records()', 'execute')::text

  union all
  select 5, 'scheduled nightly (must be true)',
         (exists (select 1 from cron.job where jobname = 'orbii-purge-incident-records'))::text

  union all
  select 6, 'the coin ledger survives the cascade (must be SET NULL)',
         (select case c.confdeltype
                   when 'n' then 'SET NULL'
                   when 'c' then 'CASCADE - WRONG, tax records would be destroyed'
                   else c.confdeltype::text end
            from pg_constraint c
           where c.conrelid = 'public.coin_transactions'::regclass
             and c.confrelid = 'public.sos_events'::regclass
             and c.contype = 'f')

  union all
  select 7, 'records already past ' || public.incident_retention()::text,
         (select count(*)::text from sos_events
           where created_at < now() - public.incident_retention())

  union all
  -- Every table holding an sos_id, and whether this purge handles it. This is
  -- the row that matters in a year: a migration that hard-codes a list of
  -- tables is wrong the moment somebody adds the tenth one, and the only
  -- defence is making the omission visible rather than invisible.
  select 8, 'table with sos_id: ' || c.relname,
         case
           when c.relname in ('sos_responders','rescue_events','sos_escalation','sos_events')
             then 'deleted directly by this purge'
           when exists (
             select 1 from pg_constraint fk
              where fk.conrelid = c.oid
                and fk.confrelid = 'public.sos_events'::regclass
                and fk.contype = 'f'
                and fk.confdeltype = 'c')
             then 'cascades from sos_events'
           when exists (
             select 1 from pg_constraint fk
              where fk.conrelid = c.oid
                and fk.confrelid = 'public.sos_events'::regclass
                and fk.contype = 'f'
                and fk.confdeltype = 'n')
             then 'kept on purpose, sos_id set to null'
           when c.relname = 'dispatch_decisions'
             then 'purged separately at 30 days (sql/144)'
           else 'NOT HANDLED - read this row before ignoring it'
         end
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'sos_id' and a.attnum > 0
  where c.relkind = 'r' and c.relnamespace = 'public'::regnamespace
) v
order by v.ord, v.check;
