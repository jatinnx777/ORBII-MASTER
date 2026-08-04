-- 64_location_scaling.sql
-- ============================================================================
-- Keeps circle-location sharing cheap enough to survive on a ₹200/student
-- budget at scale (50k+ students posting location in the background).
--
-- Two fixes:
--   1. THIN THE WRITES. circle_locations is one upserted row per user (bounded,
--      fine). The problem is circle_location_history, which would explode. We now
--      only append a breadcrumb when the user has actually MOVED (>50 m) or 5 min
--      has passed, so a phone sitting still on a desk adds ~nothing.
--   2. PRUNE. A pg_cron job wipes breadcrumbs older than 48h every hour, so the
--      history table can never grow unbounded.
--
-- Idempotent. Run once. (Uses PostGIS, already installed for helpers_live.)
-- ============================================================================

-- 1. Movement-gated breadcrumb insert.
create or replace function public.set_circle_location(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_at  timestamptz;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  -- Latest position: one cheap upsert per user (table stays bounded).
  insert into circle_locations (user_id, lat, lng, accuracy_m, battery, updated_at)
    values (auth.uid(), p_lat, p_lng, p_acc, p_battery, now())
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery, updated_at = now();

  -- Breadcrumb ONLY when meaningfully moved (>50 m) or >5 min since the last one.
  -- This is what keeps a stationary phone from writing thousands of history rows.
  select lat, lng, at into v_lat, v_lng, v_at
    from circle_location_history
    where user_id = auth.uid()
    order by at desc limit 1;

  if v_at is null
     or (now() - v_at) > interval '5 minutes'
     or ST_DistanceSphere(ST_MakePoint(p_lng, p_lat), ST_MakePoint(v_lng, v_lat)) > 50 then
    insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
  end if;
end $$;

grant execute on function public.set_circle_location(double precision, double precision, double precision, int) to authenticated;

-- 2. Prune breadcrumbs older than 48h, hourly. Needs pg_cron (Supabase supports).
create extension if not exists pg_cron;

select cron.unschedule('orbii-prune-location-history')
  where exists (select 1 from cron.job where jobname = 'orbii-prune-location-history');

select cron.schedule(
  'orbii-prune-location-history',
  '17 * * * *',
  $$ delete from circle_location_history where at < now() - interval '48 hours'; $$
);
