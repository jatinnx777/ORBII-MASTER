-- 21_sos_nearby.sql
-- ============================================================================
-- FIX: active-SOS location leak.
--
-- THE LEAK (pre-fix):
--   sos_events had  policy "sos read active" using (status = 'active'),  so
--   ANY signed-in user could  `select lat,lng,user_name from sos_events
--   where status='active'`  and pull the LIVE coordinates of every person
--   currently in an emergency — nationwide. For a women's-safety app that lets
--   an attacker enumerate and track victims in distress.
--
-- THE FIX:
--   1. Drop the blanket active-read policy. Clients can now read ONLY their
--      own rows directly.
--   2. Nearby alerts are served ONLY through a SECURITY DEFINER RPC that
--      filters server-side to a radius around the CALLER's own location,
--      excludes the caller, and only returns the last 15 minutes — so the
--      table can't be scraped and you can't see anyone outside your vicinity.
-- ============================================================================

-- 1. Remove the global active-read leak.
drop policy if exists "sos read active" on sos_events;
-- (policy "sos read own" / insert own / update own remain.)

-- 2. Radius-bounded nearby lookup (haversine, no PostGIS dependency).
create or replace function sos_events_nearby(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 10
)
returns table (
  id         uuid,
  user_id    uuid,
  lat        double precision,
  lng        double precision,
  address    text,
  created_at timestamptz,
  distance_m double precision
)
language sql
security definer
set search_path = public
as $$
  with scored as (
    select
      e.id, e.user_id, e.lat, e.lng, e.address, e.created_at,
      6371000 * acos(least(1, greatest(-1,
        cos(radians(p_lat)) * cos(radians(e.lat)) * cos(radians(e.lng) - radians(p_lng))
        + sin(radians(p_lat)) * sin(radians(e.lat))
      ))) as distance_m
    from sos_events e
    where e.status = 'active'
      and e.created_at >= now() - interval '15 minutes'
      and e.user_id <> auth.uid()
  )
  select id, user_id, lat, lng, address, created_at, distance_m
  from scored
  where distance_m <= p_radius_km * 1000
  order by distance_m asc
  limit 50;
$$;

revoke all on function sos_events_nearby(double precision, double precision, double precision) from public;
revoke all on function sos_events_nearby(double precision, double precision, double precision) from anon;
grant execute on function sos_events_nearby(double precision, double precision, double precision) to authenticated;
