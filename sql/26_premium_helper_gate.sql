-- 26_premium_helper_gate.sql
-- ============================================================================
-- Premium-gated helper dispatch.
--
-- PRODUCT RULE:
--   • Premium victim  → SOS reaches the community/responder pool nearby
--                       (strangers + verified responders) AND their circle.
--   • Free victim     → SOS reaches ONLY their family/circle in real time.
--                       It is NEVER shown to nearby strangers.
--
-- The client tags each SOS with circle_only = (NOT premium). Two paths can
-- expose an SOS to strangers, and BOTH must honour the flag:
--   1. The realtime broadcast  → gated client-side in App.tsx (circle members
--      are matched by friendUids; everyone else drops a circle_only alert).
--   2. This nearby backfill RPC → must exclude circle_only events so a
--      stranger's app can't pull a free user's live location from the table.
--      (Circle members still receive it via the broadcast + the notify-sos
--      push fan-out, so they lose nothing.)
-- ============================================================================

alter table sos_events
  add column if not exists circle_only boolean not null default false;

-- Recreate the nearby lookup with the circle_only exclusion added.
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
      and not coalesce(e.circle_only, false)   -- free users: circle-only, hidden from strangers
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
