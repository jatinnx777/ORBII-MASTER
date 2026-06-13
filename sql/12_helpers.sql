-- ORBII Helpers System — live helper presence + nearby radius search.
-- Paste into Supabase → SQL Editor → Run (once).
--
-- Design notes:
--   • PostGIS geography column + GIST index → O(log n) radius queries that
--     scale to 100k+ helpers. No paid geo APIs.
--   • The raw table is owner-only (RLS). Other users never read helper
--     locations directly; they go through the SECURITY DEFINER
--     `nearest_helpers` RPC which returns only the minimum fields needed
--     to dispatch (name, photo, distance, coords) and only for ONLINE,
--     FRESH helpers within the radius.
--   • `set_helper_location` upserts the caller's own row.

create extension if not exists postgis;

-- An earlier build created helpers_live with lat/lng columns. It only holds
-- ephemeral presence, so we drop + recreate with the PostGIS schema.
drop table if exists public.helpers_live cascade;

create table public.helpers_live (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  location   geography(Point, 4326) not null,
  is_online  boolean not null default true,
  updated_at timestamptz not null default now()
);

create index helpers_live_gix on public.helpers_live using gist (location);
create index helpers_live_online_idx on public.helpers_live (is_online, updated_at);

alter table public.helpers_live enable row level security;

-- Owner-only access to the raw row. Reads for dispatch go via the RPC.
drop policy if exists helpers_own_sel on public.helpers_live;
create policy helpers_own_sel on public.helpers_live
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists helpers_own_ins on public.helpers_live;
create policy helpers_own_ins on public.helpers_live
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists helpers_own_upd on public.helpers_live;
create policy helpers_own_upd on public.helpers_live
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists helpers_own_del on public.helpers_live;
create policy helpers_own_del on public.helpers_live
  for delete to authenticated using (auth.uid() = user_id);

-- Upsert the caller's helper location + online flag.
create or replace function public.set_helper_location(
  p_lat double precision,
  p_lng double precision,
  p_online boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into public.helpers_live (user_id, location, is_online, updated_at)
  values (
    auth.uid(),
    ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography,
    p_online,
    now()
  )
  on conflict (user_id) do update
    set location = excluded.location,
        is_online = excluded.is_online,
        updated_at = now();
end; $$;

-- Online, fresh helpers within radius_km of (lat,lng), nearest first.
-- Excludes the caller. "Fresh" = location pinged in the last 10 minutes.
create or replace function public.nearest_helpers(
  lat double precision,
  lng double precision,
  radius_km double precision default 5,
  limit_count int default 10
) returns table (
  user_id uuid,
  name text,
  photo_url text,
  rating numeric,
  distance_m double precision,
  lat_h double precision,
  lng_h double precision
)
language sql security definer set search_path = public as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography as g
  )
  select
    h.user_id,
    coalesce(u.name, 'Helper') as name,
    u.photo_url,
    5::numeric as rating,
    ST_Distance(h.location, (select g from origin)) as distance_m,
    ST_Y(h.location::geometry) as lat_h,
    ST_X(h.location::geometry) as lng_h
  from public.helpers_live h
  left join public.users_public u on u.id = h.user_id
  where h.is_online = true
    and h.user_id <> auth.uid()
    and h.updated_at > now() - interval '10 minutes'
    and ST_DWithin(h.location, (select g from origin), radius_km * 1000)
  order by h.location <-> (select g from origin)
  limit limit_count;
$$;

grant execute on function public.set_helper_location(double precision, double precision, boolean) to authenticated;
grant execute on function public.nearest_helpers(double precision, double precision, double precision, int) to authenticated;
