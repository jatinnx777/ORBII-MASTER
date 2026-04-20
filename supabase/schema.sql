-- ORBII Supabase schema. Run in the Supabase SQL editor once.
-- Safe to re-run — uses IF NOT EXISTS / IF NOT MATCHED.

-- =========================
-- 1. profiles
-- =========================
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  phone        text unique not null,
  name         text,
  photo_url    text,
  is_helper    boolean default false,
  is_premium   boolean default false,
  created_at   timestamptz default now(),

  id_kind          text check (id_kind in ('aadhaar','pan')) null,
  id_number        text null,
  id_photo_url     text null,
  id_verification  text default 'unverified'
    check (id_verification in ('unverified','pending','verified','rejected'))
);

alter table public.profiles enable row level security;

drop policy if exists "profiles self-select" on public.profiles;
create policy "profiles self-select"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles self-upsert" on public.profiles;
create policy "profiles self-upsert"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles self-update" on public.profiles;
create policy "profiles self-update"
  on public.profiles for update
  using (auth.uid() = id);

-- =========================
-- 2. helpers_live  (one row per user while online)
-- =========================
create table if not exists public.helpers_live (
  user_id    uuid primary key references public.profiles on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  updated_at timestamptz default now(),
  rating     numeric default 5.0,
  is_online  boolean default true
);

alter table public.helpers_live enable row level security;

drop policy if exists "helpers_live readable" on public.helpers_live;
create policy "helpers_live readable"
  on public.helpers_live for select
  using (is_online = true);

drop policy if exists "helpers_live self-write" on public.helpers_live;
create policy "helpers_live self-write"
  on public.helpers_live for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================
-- 3. sos_events
-- =========================
create table if not exists public.sos_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles on delete cascade,
  lat          double precision not null,
  lng          double precision not null,
  address      text,
  status       text default 'active'
    check (status in ('active','resolved','cancelled')),
  responder_id uuid references public.profiles,
  response_time_sec integer,
  rating       numeric,
  created_at   timestamptz default now(),
  resolved_at  timestamptz
);

alter table public.sos_events enable row level security;

drop policy if exists "sos self-read" on public.sos_events;
create policy "sos self-read"
  on public.sos_events for select
  using (auth.uid() = user_id or auth.uid() = responder_id);

drop policy if exists "sos self-insert" on public.sos_events;
create policy "sos self-insert"
  on public.sos_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "sos responder-update" on public.sos_events;
create policy "sos responder-update"
  on public.sos_events for update
  using (auth.uid() = user_id or auth.uid() = responder_id);

-- =========================
-- 4. emergency_contacts
-- =========================
create table if not exists public.emergency_contacts (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references public.profiles on delete cascade,
  name      text not null,
  phone     text not null,
  relation  text,
  created_at timestamptz default now()
);

alter table public.emergency_contacts enable row level security;

drop policy if exists "contacts self-rw" on public.emergency_contacts;
create policy "contacts self-rw"
  on public.emergency_contacts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================
-- 5. Nearest-helper RPC — spherical law of cosines (good for short distances)
-- Returns helpers closest to (lat,lng) within radius_km.
-- =========================
create or replace function public.nearest_helpers(
  lat double precision,
  lng double precision,
  radius_km double precision default 5.0,
  limit_count integer default 10
)
returns table (
  user_id uuid,
  name text,
  photo_url text,
  rating numeric,
  distance_m double precision,
  lat_h double precision,
  lng_h double precision
)
language sql stable as $$
  select
    h.user_id,
    p.name,
    p.photo_url,
    h.rating,
    (6371000 * acos(
      greatest(-1.0, least(1.0,
        cos(radians(lat)) * cos(radians(h.lat))
          * cos(radians(h.lng) - radians(lng))
        + sin(radians(lat)) * sin(radians(h.lat))
      ))
    )) as distance_m,
    h.lat as lat_h,
    h.lng as lng_h
  from public.helpers_live h
  join public.profiles p on p.id = h.user_id
  where h.is_online = true
    and p.id_verification = 'verified'
    and (6371000 * acos(
      greatest(-1.0, least(1.0,
        cos(radians(lat)) * cos(radians(h.lat))
          * cos(radians(h.lng) - radians(lng))
        + sin(radians(lat)) * sin(radians(h.lat))
      ))
    )) <= radius_km * 1000
  order by distance_m asc
  limit limit_count;
$$;
