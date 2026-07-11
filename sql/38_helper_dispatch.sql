-- 38_helper_dispatch.sql
-- ============================================================================
-- Server-side dispatch: which VERIFIED helpers should be pushed an incoming SOS.
--
-- Used by the notify-sos edge function (service role) to reach verified helpers
-- when a PREMIUM victim fires an SOS — even when the helper's app is closed.
-- Free victims never reach strangers (their SOS is circle_only), so the edge
-- function only calls this for premium victims.
--
-- Runs as SECURITY DEFINER and does NOT depend on auth.uid(): the edge function
-- calls it with the service role, where auth.uid() is null. (nearest_helpers in
-- sql/12 filters on `<> auth.uid()`, so it returns nothing under the service
-- role — that's why this is a separate function.)
-- ============================================================================

create or replace function public.dispatch_verified_helpers(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 7,
  p_exclude   uuid default null
)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g
  )
  select h.user_id
  from public.helpers_live h
  join public.helper_profiles hp on hp.user_id = h.user_id
  where h.is_online = true
    and h.updated_at > now() - interval '10 minutes'   -- still actually online
    and hp.verification_status = 'verified'             -- verified helpers only
    and (p_exclude is null or h.user_id <> p_exclude)   -- never the victim
    and ST_DWithin(h.location, (select g from origin), p_radius_km * 1000)
  order by h.location <-> (select g from origin)         -- nearest first
  limit 50;
$$;

-- The edge function runs as the service role, which may call any function, but
-- grant explicitly so the intent is clear and it stays callable if invoked
-- from an authenticated context in future.
grant execute on function public.dispatch_verified_helpers(
  double precision, double precision, double precision, uuid
) to service_role, authenticated;
