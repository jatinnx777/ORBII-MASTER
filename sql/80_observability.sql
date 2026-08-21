-- 80_observability.sql
-- ============================================================================
-- Making edge-function failures visible.
--
-- The app already reports crashes: error-reporting.ts inserts into
-- client_errors and the founder reads them in the admin portal. Edge functions
-- report NOWHERE. A drain-push that 500s on every invocation, or an Expo
-- credential that silently stops being accepted, produces no row, no alert,
-- and no symptom until somebody notices a push never arrived.
--
-- That is the same failure class as everything else in this codebase: broken
-- looks exactly like working. So:
--
--   1. function_errors  — the server-side twin of client_errors.
--   2. push_outbox_health() — a queue-depth check that turns "stuck" into a
--      number somebody can alert on.
--
-- No new vendor and no cost. If a Sentry DSN is set in the function env, the
-- shared reporter forwards there as well, but nothing depends on it.
--
-- Run AFTER sql/79.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. FUNCTION ERRORS
-- ---------------------------------------------------------------------------
create table if not exists public.function_errors (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  fn         text        not null,          -- 'drain-push', 'notify-sos', ...
  message    text        not null,
  context    jsonb,                          -- sosId, batch size, http status
  severity   text        not null default 'error'
    check (severity in ('warn', 'error', 'fatal'))
);

alter table public.function_errors enable row level security;

create index if not exists idx_function_errors_recent
  on public.function_errors (created_at desc);

-- Admins read it (the portal). Nobody else, because context can carry a sosId.
drop policy if exists "fn errors admin read" on public.function_errors;
create policy "fn errors admin read" on public.function_errors
  for select to authenticated using (public.is_admin());

-- Written only by the service role through this function, never by a client.
create or replace function public.log_function_error(
  p_fn       text,
  p_message  text,
  p_context  jsonb default null,
  p_severity text default 'error'
)
returns void
language sql security definer set search_path = public as $$
  insert into public.function_errors (fn, message, context, severity)
  values (p_fn, left(p_message, 2000), p_context,
          case when p_severity in ('warn','error','fatal') then p_severity else 'error' end);
$$;

grant execute on function public.log_function_error(text, text, jsonb, text) to service_role;

-- Keep it bounded. Two weeks is long enough to spot a pattern.
create or replace function public.function_errors_sweep()
returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.function_errors where created_at < now() - interval '14 days'
    returning 1
  )
  select count(*)::int from gone;
$$;

grant execute on function public.function_errors_sweep() to service_role;


-- ---------------------------------------------------------------------------
-- 2. PUSH QUEUE HEALTH
-- ---------------------------------------------------------------------------
-- The signal that matters is not "did an error happen" but "is anything
-- stuck". A drain that dies silently produces no errors at all: rows simply
-- stop being marked sent. So measure the queue, not the exceptions.
--
-- `oldest_pending_s` is the number to alert on. Under normal operation the
-- drain is invoked within a second of enqueue, so anything above a minute means
-- the drain is not running.
create or replace function public.push_outbox_health()
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'pending',          count(*) filter (where sent_at is null),
    'sos_pending',      count(*) filter (where sent_at is null and priority = 0),
    'failing',          count(*) filter (where sent_at is null and attempts >= 3),
    'dead',             count(*) filter (where sent_at is null and attempts >= 5),
    'oldest_pending_s', coalesce(
                          extract(epoch from (now() - min(created_at)
                            filter (where sent_at is null)))::int, 0),
    'sent_last_hour',   count(*) filter (where sent_at > now() - interval '1 hour'),
    'checked_at',       now()
  )
  from public.push_outbox;
$$;

grant execute on function public.push_outbox_health() to service_role;
-- Admins see it in the portal too.
grant execute on function public.push_outbox_health() to authenticated;


-- ---------------------------------------------------------------------------
-- 3. THE ALARM
-- ---------------------------------------------------------------------------
-- A health function nobody calls is not observability. This cron turns a stuck
-- queue into a row in function_errors, which the admin portal already surfaces.
--
-- Deliberately conservative: it fires on SOS-priority rows older than two
-- minutes, or any dead-lettered row. A push that is merely slow is not worth
-- waking anyone for; an emergency push that has not moved in two minutes is.
create or replace function public.push_outbox_alarm()
returns void
language plpgsql security definer set search_path = public as $$
declare h jsonb;
begin
  h := public.push_outbox_health();

  if (h->>'sos_pending')::int > 0 and (h->>'oldest_pending_s')::int > 120 then
    perform public.log_function_error(
      'drain-push',
      'Emergency pushes have been queued for over two minutes. The drain is probably not running.',
      h, 'fatal');
  elsif (h->>'dead')::int > 0 then
    perform public.log_function_error(
      'drain-push',
      'Push rows have exhausted their retries and will never be delivered.',
      h, 'error');
  end if;
end $$;

grant execute on function public.push_outbox_alarm() to service_role;


-- ---------------------------------------------------------------------------
-- 4. SCHEDULES
-- ---------------------------------------------------------------------------
select cron.unschedule('orbii-push-alarm')
  where exists (select 1 from cron.job where jobname = 'orbii-push-alarm');
select cron.schedule('orbii-push-alarm', '* * * * *',
  $$select public.push_outbox_alarm();$$);

select cron.unschedule('orbii-function-errors-sweep')
  where exists (select 1 from cron.job where jobname = 'orbii-function-errors-sweep');
select cron.schedule('orbii-function-errors-sweep', '41 3 * * *',
  $$select public.function_errors_sweep();$$);


-- ---------------------------------------------------------------------------
-- 5. VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  select string_agg(check_name || ': ' || result, e'\n') into msg
  from (
    select 'function_errors' as check_name,
           case when to_regclass('public.function_errors') is not null
                then 'ok' else 'MISSING' end as result
    union all
    select 'push_outbox_health',
           case when exists (select 1 from pg_proc where proname = 'push_outbox_health')
                then 'ok' else 'MISSING' end
    union all
    select 'alarm scheduled',
           case when exists (select 1 from cron.job where jobname = 'orbii-push-alarm')
                then 'ok' else 'MISSING' end
  ) checks;
  raise notice e'\n%', msg;
end $$;
