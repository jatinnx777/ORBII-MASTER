-- 46_community_dispatch.sql
-- ============================================================================
-- Server-side dispatch: which nearby COMMUNITY responders should be pushed a
-- FREE user's SOS.
--
-- Companion to dispatch_verified_helpers (sql/38). That one returns nearby
-- VERIFIED helpers — the reliable, vetted pool reserved for PAID victims. This
-- one returns nearby NON-verified online helpers: ordinary ORBII users who
-- turned on helper mode and are close by. They're the "random people who may or
-- may not come" that a free user's SOS now reaches.
--
-- Only people with helper mode ON (a row in helpers_live) are reachable by
-- proximity — that's the opt-in responder pool. A user who never volunteered to
-- respond has no server-side location and is never targeted.
--
-- Runs as SECURITY DEFINER, called by the notify-sos edge function with the
-- service role (auth.uid() is null there), same pattern as sql/38.
-- ============================================================================

create or replace function public.dispatch_community_helpers(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 5,
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
  left join public.helper_profiles hp on hp.user_id = h.user_id
  where h.is_online = true
    and h.updated_at > now() - interval '10 minutes'          -- still actually online
    -- Non-verified only: verified helpers are the PAID tier's advantage and are
    -- dispatched separately by dispatch_verified_helpers.
    and coalesce(hp.verification_status, 'none') <> 'verified'
    and (p_exclude is null or h.user_id <> p_exclude)          -- never the victim
    and ST_DWithin(h.location, (select g from origin), p_radius_km * 1000)
  order by h.location <-> (select g from origin)                -- nearest first
  limit 50;
$$;

grant execute on function public.dispatch_community_helpers(
  double precision, double precision, double precision, uuid
) to service_role, authenticated;
