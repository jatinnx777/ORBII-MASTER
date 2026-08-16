-- 73_midnight_wipe.sql
-- ============================================================================
-- Daily reset of location history.
--
-- Circle history is a TODAY-only feature: members can see where the others went
-- and how long they stopped, and at midnight it is gone. Not archived, not
-- moved to cold storage, deleted.
--
-- This replaces the rolling 48 hour prune from sql/64 with a hard cut at local
-- midnight, which is both the product promise and the cleanest possible answer
-- to the DPDP retention requirement ("keep it only as long as the purpose
-- needs"). The purpose is one day, so the retention is one day.
--
-- Times are IST (Asia/Kolkata), since that is where every user is.
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

-- Replace the old rolling window with the midnight cut.
select cron.unschedule('orbii-prune-location-history')
  where exists (select 1 from cron.job where jobname = 'orbii-prune-location-history');

select cron.unschedule('orbii-midnight-location-wipe')
  where exists (select 1 from cron.job where jobname = 'orbii-midnight-location-wipe');

-- 18:30 UTC == 00:00 IST. Deletes every breadcrumb from the day that just ended.
select cron.schedule(
  'orbii-midnight-location-wipe',
  '30 18 * * *',
  $$ delete from circle_location_history
       where at < date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata'; $$
);

-- Safety net. pg_cron can be paused, a project can sleep on the free tier, and a
-- missed run would silently keep yesterday's movements alive. Every read of a
-- member's trail therefore filters to today as well, so stale rows can never be
-- shown even if the wipe has not fired yet.
create or replace function public.circle_member_trail(p_uid uuid, p_hours int default 24)
returns table (lat double precision, lng double precision, at timestamptz)
language sql security definer set search_path = public as $$
  select h.lat, h.lng, h.at
  from circle_location_history h
  where h.user_id = p_uid
    and (h.user_id = auth.uid() or public.shares_circle_with(p_uid))
    and h.at > now() - make_interval(hours => p_hours)
    -- Never return anything from before today's local midnight.
    and h.at >= (date_trunc('day', (now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata')
  order by h.at desc
  limit 500;
$$;

grant execute on function public.circle_member_trail(uuid, int) to authenticated;
