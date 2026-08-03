-- 58_geofence_autoescalate.sql  (OPTIONAL / ADVANCED)
-- ============================================================================
-- Finishes the geofence "did you mean to leave?" flow: the NO-ANSWER case.
--
-- Today: if the fenced person taps "Alert my circle", the watchers are told
-- immediately. If she just ignores the prompt, nothing escalates. This adds the
-- safety net: a scheduled sweep escalates any exit still unanswered after a few
-- minutes, so silence is treated as "something might be wrong".
--
-- This is OPTIONAL. It needs two Supabase extensions (pg_cron + pg_net), and you
-- must paste in your project URL + anon key below. If you'd rather keep it simple
-- for now, skip this whole file; the explicit "Alert my circle" button still
-- works without it.
--
-- BEFORE RUNNING: replace the two placeholders marked <<< ... >>>.
-- ============================================================================

-- 1. Enable the extensions (safe to run if already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. The escalator: for each exit still pending past p_minutes, mark it
-- unauthorized and push whoever set the zone via the notify-geofence function.
create or replace function public.escalate_stale_geofence_leaves(p_minutes int default 5)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select e.id as event_id, e.geofence_id, e.member_id
    from geofence_events e
    where e.kind = 'exit'
      and e.authorized is null
      and e.created_at < now() - make_interval(mins => p_minutes)
  loop
    -- Mark it escalated so we don't push it twice.
    update geofence_events set authorized = false, resolved_at = now() where id = r.event_id;

    -- Tell the watchers. Replace the URL + anon key with your project's values.
    perform net.http_post(
      url := '<<< https://YOUR-PROJECT-REF.supabase.co/functions/v1/notify-geofence >>>',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer <<< YOUR-SUPABASE-ANON-KEY >>>'
      ),
      body := jsonb_build_object(
        'geofenceId', r.geofence_id,
        'kind', 'exit',
        'eventId', r.event_id,
        'unauthorized', true
      )
    );
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.escalate_stale_geofence_leaves(int) from public, anon, authenticated;

-- 3. Run it every 2 minutes. (Escalates exits unanswered for 5+ minutes.)
-- Re-running this file is safe: unschedule first, then schedule fresh.
select cron.unschedule('orbii-geofence-escalate')
  where exists (select 1 from cron.job where jobname = 'orbii-geofence-escalate');

select cron.schedule(
  'orbii-geofence-escalate',
  '*/2 * * * *',
  $$ select public.escalate_stale_geofence_leaves(5); $$
);
