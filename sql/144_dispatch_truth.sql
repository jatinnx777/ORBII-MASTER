-- 144_dispatch_truth.sql
-- ============================================================================
-- Three things, all about the dispatcher telling the truth about itself.
--
--   1. The wave selector's own freshness window, which sql/143 MISSED.
--   2. A trigger reason for a helper who is in trouble themselves.
--   3. A record of every helper the dispatcher considered, and why it passed
--      over the ones it skipped.
--
-- Idempotent. No transaction control, nothing here can raise.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. THE ONE sql/143 MISSED
--
-- sql/143 rewrote `interval '10 minutes'` in three functions and reported all
-- three green. next_wave_helpers, the function that actually picks who gets a
-- wave, uses `interval '15 minutes'` and was never touched. Its verify could
-- not catch that, because the verify only listed the three names the migration
-- already knew about: a check that can only confirm what its author believed.
--
-- So the selector that matters most was the loosest of the four, fifteen
-- minutes, against a client that calls a helper stale at ninety seconds.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(oid) into v_src
  from pg_proc
  where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace
  limit 1;

  if v_src is null then
    raise notice 'next_wave_helpers absent, nothing to tighten';
  else
    v_new := replace(v_src, 'interval ''15 minutes''', 'interval ''4 minutes''');
    if v_new = v_src then
      raise notice 'next_wave_helpers has no 15-minute window, left alone';
    else
      execute v_new;
      raise notice 'next_wave_helpers tightened to 4 minutes';
    end if;
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- 2. A HELPER CAN BE THE ONE IN TROUBLE
--
-- Responders walk towards situations other people walk away from, at night, to
-- addresses they do not know. Until now the only person who could raise an SOS
-- in this system was the person who asked for help.
--
-- `helper_unsafe` is a real SOS for the helper, through the existing pipeline:
-- their own circle, their own escalation, one tap to 112. It is NOT a call to a
-- control centre, because there is no control centre, and the app says so.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'sos_events_trigger_check';

  if v_def is null then
    raise notice 'sos_events_trigger_check absent, nothing to widen';
  elsif v_def like '%helper_unsafe%' then
    raise notice 'helper_unsafe already accepted';
  else
    alter table sos_events drop constraint sos_events_trigger_check;
    alter table sos_events add constraint sos_events_trigger_check
      check (trigger in (
        'manual', 'voice', 'impact', 'geofence', 'disaster',
        'scream', 'shake', 'crash', 'helper_unsafe'
      ));
    raise notice 'helper_unsafe accepted';
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- 3. WHY THE DISPATCHER PASSED SOMEBODY OVER
--
-- Every bug found in this system this week was invisible for the same reason:
-- nothing recorded the decisions. helper_dispatches records who WAS sent, which
-- answers half the question. The half that mattered each time was who was NOT,
-- and why.
--
-- NO LOCATION, NO VICTIM DETAIL. Ids, a wave number, a reason. This exists to
-- answer "why did nobody come" a week later, and it must never become a
-- second, quieter record of where helpers were.
-- ---------------------------------------------------------------------------
create table if not exists public.dispatch_decisions (
  id         uuid primary key default gen_random_uuid(),
  sos_id     uuid not null,
  wave       integer,
  helper_id  uuid not null,
  decision   text not null check (decision in (
                'dispatched',
                'excluded_stale',
                'excluded_already_dispatched',
                'excluded_off_duty',
                'excluded_out_of_radius',
                'excluded_self',
                'excluded_other')),
  reason     text,
  created_at timestamptz not null default now()
);

comment on table public.dispatch_decisions is
  'Why the dispatcher chose or skipped each helper. Ids and reasons only, never location. Purged after 30 days.';

create index if not exists dispatch_decisions_sos_idx
  on public.dispatch_decisions (sos_id, created_at desc);
create index if not exists dispatch_decisions_age_idx
  on public.dispatch_decisions (created_at);

alter table public.dispatch_decisions enable row level security;

-- Nobody reads this from a phone. It is written by SECURITY DEFINER functions
-- and read by whoever is debugging, through the service role. RLS on with no
-- policy means no client can read it at all, which is the right answer for a
-- table listing who was near an emergency.
revoke all on table public.dispatch_decisions from anon, authenticated;
grant select, insert, delete on table public.dispatch_decisions to service_role;


create or replace function public.purge_dispatch_decisions()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare n int;
begin
  delete from dispatch_decisions where created_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.purge_dispatch_decisions() from public, anon, authenticated;
grant execute on function public.purge_dispatch_decisions() to service_role;

do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('orbii-purge-dispatch-decisions')
      where exists (select 1 from cron.job where jobname = 'orbii-purge-dispatch-decisions');
    perform cron.schedule('orbii-purge-dispatch-decisions', '30 3 * * *',
                          'select public.purge_dispatch_decisions();');
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'next_wave_helpers freshness window' as check,
       (regexp_match(regexp_replace(pg_get_functiondef(oid), '\s+', ' ', 'g'),
                     'interval ''([0-9]+ [a-z]+)'''))[1] as result
from pg_proc where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace

union all
select 'next_wave_helpers is still SECURITY DEFINER (must be true)',
       (select prosecdef::text from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'sos_events accepts helper_unsafe (must be true)',
       (pg_get_constraintdef((select oid from pg_constraint
          where conname = 'sos_events_trigger_check')) like '%helper_unsafe%')::text

union all
select 'it still accepts crash and voice (must be true)',
       ((pg_get_constraintdef((select oid from pg_constraint
           where conname = 'sos_events_trigger_check')) like '%crash%')
        and (pg_get_constraintdef((select oid from pg_constraint
           where conname = 'sos_events_trigger_check')) like '%voice%'))::text

union all
select 'every existing SOS still satisfies the constraint (must be true)',
       (select coalesce(bool_and(trigger in (
          'manual','voice','impact','geofence','disaster',
          'scream','shake','crash','helper_unsafe')), true)::text from sos_events)

union all
select 'dispatch_decisions exists (must be true)',
       (to_regclass('public.dispatch_decisions') is not null)::text

union all
select 'no phone can read dispatch_decisions (must be false)',
       has_table_privilege('authenticated', 'public.dispatch_decisions', 'SELECT')::text

union all
select 'it holds no location column (must be true)',
       (not exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'dispatch_decisions'
            and column_name in ('lat','lng','location','geom')))::text

union all
select 'the 30-day purge is scheduled',
       (exists (select 1 from cron.job where jobname = 'orbii-purge-dispatch-decisions'))::text;
