-- 83_service_areas.sql
-- ============================================================================
-- Coverage gating for the Community Helper Network.
--
-- The helper network only makes sense where helpers exist. Outside Delhi-NCR
-- there are none, so dispatching there produces the worst outcome the product
-- can produce: a woman told help is coming, from a network that has nobody to
-- send. Better to say plainly that the network is not live and keep the
-- Personal Shield running, which works anywhere on earth.
--
-- WHAT THIS DOES NOT GATE, and must never gate:
--   Voice SOS, SMS relay, circle alerts, evidence recording, 112. Those are the
--   product. They stay on globally, and nothing in this file touches them.
--
-- ── DESIGN NOTES ────────────────────────────────────────────────────────────
--
-- AREAS LIVE IN A TABLE, NOT IN A FUNCTION BODY. Expanding to Pune or
-- Bengaluru is then an INSERT, not a migration and an app release. That is the
-- whole point of the Blinkit model: coverage changes weekly, code does not.
--
-- ST_COVERS, NOT ST_CONTAINS. ST_Contains returns FALSE for a point sitting
-- exactly on the boundary. Somebody standing on the edge of the polygon would
-- be told the network is unavailable while a helper 100 m away is inside it.
-- ST_Covers includes the boundary and is the correct predicate for coverage.
--
-- GEOMETRY FOR CONTAINMENT, GEOGRAPHY FOR DISTANCE. Containment is a planar
-- question and geometry is both correct and far faster; distance over ~1 km at
-- this latitude needs geography or the answer is wrong by hundreds of metres.
-- The table stores both, derived, so neither operation casts at query time.
-- ============================================================================

create extension if not exists postgis;

-- ---------------------------------------------------------------------------
-- 1. SERVICE AREAS
-- ---------------------------------------------------------------------------
create table if not exists service_areas (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  -- Planar copy, used for containment tests.
  boundary      geometry(Polygon, 4326) not null,
  -- Spheroid copy, used for distance-to-edge and any buffering.
  boundary_geog geography(Polygon, 4326)
    generated always as (boundary::geography) stored,
  -- How many verified helpers must be within radius_m before the network is
  -- declared available. Per-area because a dense city needs a higher bar than
  -- a new one, where two helpers is genuinely better than nothing.
  min_helpers   int not null default 3 check (min_helpers >= 1),
  radius_m      int not null default 2000 check (radius_m between 200 and 20000),
  -- Soft switch, so an area can be pulled instantly without deleting the
  -- polygon and losing the shape.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists service_areas_gix
  on service_areas using gist (boundary);
create index if not exists service_areas_active_idx
  on service_areas (is_active) where is_active = true;

alter table service_areas enable row level security;

-- Readable by anyone signed in: the client needs to know whether to show the
-- helper card at all. The polygon is not sensitive, it is marketing.
drop policy if exists service_areas_read on service_areas;
create policy service_areas_read on service_areas
  for select to authenticated using (is_active = true);

-- Only admins may reshape coverage. No client-side writes, ever.
drop policy if exists service_areas_admin on service_areas;
create policy service_areas_admin on service_areas
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 2. THE DELHI-NCR POLYGON
-- ---------------------------------------------------------------------------
-- APPROXIMATE, and deliberately so. This is not the gazetted NCR boundary,
-- which includes districts as far out as Alwar and Muzaffarnagar where we have
-- no helpers at all. It is a hand-drawn hull around the contiguous urban area
-- we can actually serve:
--
--   Sonipat (N) -> Ghaziabad (NE) -> Greater Noida (E) -> Noida (SE)
--   -> Faridabad (S) -> Gurugram (SW) -> Bahadurgarh side (W) -> back to Sonipat
--
-- Vertices are lng,lat. Ring closes on the first point, as PostGIS requires.
insert into service_areas (slug, name, boundary, min_helpers, radius_m)
values (
  'delhi-ncr',
  'Delhi NCR',
  ST_GeomFromText(
    'POLYGON((
       76.90 29.05,
       77.12 29.02,
       77.35 28.78,
       77.52 28.72,
       77.62 28.52,
       77.55 28.40,
       77.38 28.28,
       77.20 28.24,
       77.02 28.30,
       76.86 28.42,
       76.80 28.62,
       76.84 28.86,
       76.90 29.05
     ))',
    4326
  ),
  3,
  2000
)
on conflict (slug) do update
  set boundary    = excluded.boundary,
      name        = excluded.name,
      min_helpers = excluded.min_helpers,
      radius_m    = excluded.radius_m,
      updated_at  = now();

-- ---------------------------------------------------------------------------
-- 3. COVERAGE CHECK
-- ---------------------------------------------------------------------------
-- Returns a single jsonb payload the client renders directly.
--
-- SECURITY DEFINER because helpers_live is owner-only under RLS: a user must be
-- able to learn HOW MANY helpers are near them without being able to read WHO
-- or WHERE any of them is. The function returns a count and nothing else, which
-- is exactly the boundary that makes this safe to expose.
create or replace function public.check_helper_network_availability(
  user_lat double precision,
  user_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid := auth.uid();
  pt_geom   geometry(Point, 4326);
  pt_geog   geography(Point, 4326);
  area      service_areas%rowtype;
  n_helpers int := 0;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- Reject impossible coordinates before they reach PostGIS. A NaN silently
  -- makes every spatial predicate false, which would look identical to "you
  -- are out of coverage" and would be maddening to debug in the field.
  if user_lat is null or user_lng is null
     or user_lat <> user_lat or user_lng <> user_lng          -- NaN check
     or user_lat not between -90 and 90
     or user_lng not between -180 and 180 then
    return jsonb_build_object(
      'is_in_delhi_ncr',         false,
      'helper_network_available', false,
      'nearby_helpers_count',     0,
      'status_code',              'INVALID_LOCATION',
      'message',                  'We could not read your location. Personal Shield (Voice SOS, SMS, family alerts) is still fully active.'
    );
  end if;

  pt_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326);
  pt_geog := pt_geom::geography;

  -- Which active area covers this point, if any. ST_Covers includes the edge.
  select * into area
  from service_areas s
  where s.is_active = true
    and ST_Covers(s.boundary, pt_geom)
  order by ST_Area(s.boundary) asc   -- smallest matching area wins if nested
  limit 1;

  if not found then
    return jsonb_build_object(
      'is_in_delhi_ncr',         false,
      'helper_network_available', false,
      'nearby_helpers_count',     0,
      'status_code',              'OUT_OF_COVERAGE',
      'message',                  'ORBII Helper Network is not live in your area yet. Personal Shield (Voice SOS, SMS, Family Alerts) remains 100% active.'
    );
  end if;

  -- Inside an area: are there actually enough verified helpers nearby?
  --
  -- Mirrors dispatch_verified_helpers (sql/38) exactly, including the ten
  -- minute freshness window. If this said "available" using different rules
  -- from the dispatcher, we would promise a network that then sends nobody,
  -- and that divergence is the bug most worth designing out.
  select count(*)
    into n_helpers
  from helpers_live h
  join helper_profiles hp on hp.user_id = h.user_id
  where h.is_online = true
    and h.updated_at > now() - interval '10 minutes'
    and hp.verification_status = 'verified'
    and h.user_id <> uid                            -- never count yourself
    and ST_DWithin(h.location, pt_geog, area.radius_m);

  if n_helpers >= area.min_helpers then
    return jsonb_build_object(
      'is_in_delhi_ncr',         true,
      'helper_network_available', true,
      'nearby_helpers_count',     n_helpers,
      'area_slug',                area.slug,
      'area_name',                area.name,
      'status_code',              'FULL_SHIELD_ACTIVE',
      'message',                  'Full Community Shield & Helper Network is active in your area.'
    );
  end if;

  -- Inside the area but thin on helpers right now. This is a DIFFERENT state
  -- from being out of coverage and must read differently: the network exists
  -- here, it is just quiet at this moment, and that can change within minutes.
  return jsonb_build_object(
    'is_in_delhi_ncr',         true,
    'helper_network_available', false,
    'nearby_helpers_count',     n_helpers,
    'area_slug',                area.slug,
    'area_name',                area.name,
    'status_code',              'LOW_COVERAGE',
    'message',                  'Few responders are on duty near you right now. Your circle, Voice SOS and SMS alerts are fully active.'
  );
end $$;

revoke all on function public.check_helper_network_availability(double precision, double precision)
  from public, anon;
grant execute on function public.check_helper_network_availability(double precision, double precision)
  to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare
  ncr_ok  boolean;
  out_ok  boolean;
begin
  -- Connaught Place, central Delhi. Must be inside.
  select ST_Covers(boundary, ST_SetSRID(ST_MakePoint(77.2167, 28.6315), 4326))
    into ncr_ok from service_areas where slug = 'delhi-ncr';
  -- Bandra, Mumbai. Must be outside.
  select not ST_Covers(boundary, ST_SetSRID(ST_MakePoint(72.8296, 19.0596), 4326))
    into out_ok from service_areas where slug = 'delhi-ncr';

  raise notice E'\ndelhi-ncr covers Connaught Place : %\ndelhi-ncr excludes Mumbai        : %',
    coalesce(ncr_ok, false), coalesce(out_ok, false);

  if not coalesce(ncr_ok, false) or not coalesce(out_ok, false) then
    raise exception 'service area polygon failed its sanity check';
  end if;
end $$;
