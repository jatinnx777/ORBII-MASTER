-- 63_circle_locations.sql
-- ============================================================================
-- Circle live map: opt-in live location sharing among circle members, plus a
-- breadcrumb history (where were they at 9:40?). This is the Life360-style layer
-- that pairs with geofencing. Privacy-first: you only ever appear to people you
-- share a circle with, and only while you have sharing ON.
--
-- Reuses shares_circle_with(uuid) from sql/41. Idempotent. Run once.
-- ============================================================================

-- Latest known position, one row per user.
create table if not exists circle_locations (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  double precision,
  battery     int,
  updated_at  timestamptz not null default now()
);

alter table circle_locations enable row level security;
drop policy if exists circle_loc_read on circle_locations;
create policy circle_loc_read on circle_locations
  for select to authenticated
  using (user_id = auth.uid() or public.shares_circle_with(user_id));
-- Writes go through set_circle_location (SECURITY DEFINER) only.

-- Breadcrumb trail (the "location history" premium feature).
create table if not exists circle_location_history (
  id      bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat     double precision not null,
  lng     double precision not null,
  at      timestamptz not null default now()
);
create index if not exists circle_loc_hist_idx on circle_location_history (user_id, at desc);

alter table circle_location_history enable row level security;
drop policy if exists circle_hist_read on circle_location_history;
create policy circle_hist_read on circle_location_history
  for select to authenticated
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

-- Upsert my own position (+ append a breadcrumb).
create or replace function public.set_circle_location(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into circle_locations (user_id, lat, lng, accuracy_m, battery, updated_at)
    values (auth.uid(), p_lat, p_lng, p_acc, p_battery, now())
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery, updated_at = now();
  insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
end $$;

grant execute on function public.set_circle_location(double precision, double precision, double precision, int) to authenticated;

-- Stop sharing: forget my live position (history is kept unless you also prune it).
create or replace function public.clear_circle_location()
returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from circle_locations where user_id = auth.uid();
end $$;

grant execute on function public.clear_circle_location() to authenticated;

-- Latest positions of everyone in my circles (who is currently sharing).
create or replace function public.circle_members_locations()
returns table (
  user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, updated_at timestamptz, battery int
)
language sql security definer set search_path = public as $$
  select l.user_id, u.name, u.photo_url, l.lat, l.lng, l.updated_at, l.battery
  from circle_locations l
  join users_public u on u.id = l.user_id
  where l.user_id <> auth.uid()
    and public.shares_circle_with(l.user_id)
    and l.updated_at > now() - interval '1 day'
  order by l.updated_at desc;
$$;

grant execute on function public.circle_members_locations() to authenticated;

-- A member's recent breadcrumb trail (newest first), for the history view.
create or replace function public.circle_member_trail(p_uid uuid, p_hours int default 12)
returns table (lat double precision, lng double precision, at timestamptz)
language sql security definer set search_path = public as $$
  select h.lat, h.lng, h.at
  from circle_location_history h
  where h.user_id = p_uid
    and (h.user_id = auth.uid() or public.shares_circle_with(p_uid))
    and h.at > now() - make_interval(hours => p_hours)
  order by h.at desc
  limit 500;
$$;

grant execute on function public.circle_member_trail(uuid, int) to authenticated;
