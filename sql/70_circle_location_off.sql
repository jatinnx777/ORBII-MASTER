-- 70_circle_location_off.sql
-- ============================================================================
-- Keep a member's LAST known position when they turn live sharing OFF, and flag
-- it, so the Circle map can show "location off, last seen ..." instead of the
-- person simply disappearing. Previously clear_circle_location() deleted the
-- row; now it keeps the last fix and marks sharing = false.
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

alter table circle_locations
  add column if not exists sharing boolean not null default true;
alter table circle_locations
  add column if not exists sharing_off_at timestamptz;

-- Sharing a fix always means sharing is ON.
create or replace function public.set_circle_location(
  p_lat double precision, p_lng double precision,
  p_acc double precision default null, p_battery int default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into circle_locations (user_id, lat, lng, accuracy_m, battery, updated_at, sharing, sharing_off_at)
    values (auth.uid(), p_lat, p_lng, p_acc, p_battery, now(), true, null)
  on conflict (user_id) do update
    set lat = excluded.lat, lng = excluded.lng,
        accuracy_m = excluded.accuracy_m, battery = excluded.battery,
        updated_at = now(), sharing = true, sharing_off_at = null;
  insert into circle_location_history (user_id, lat, lng) values (auth.uid(), p_lat, p_lng);
end $$;

grant execute on function public.set_circle_location(double precision, double precision, double precision, int) to authenticated;

-- Stop sharing: KEEP the last position, just mark it off (was: delete the row).
create or replace function public.clear_circle_location()
returns void
language plpgsql security definer set search_path = public as $$
begin
  update circle_locations
    set sharing = false, sharing_off_at = now()
    where user_id = auth.uid();
end $$;

grant execute on function public.clear_circle_location() to authenticated;

-- The RETURNS TABLE shape changes (adds sharing + sharing_off_at), so the old
-- function must be dropped before it can be recreated.
drop function if exists public.circle_members_locations();

-- Latest positions of everyone in my circles, INCLUDING those who turned sharing
-- off (their last known position), with the sharing flag so the client can show
-- "location off". Sharing members show if fresh within a day; off members show
-- their last known for up to 7 days, then drop.
create or replace function public.circle_members_locations()
returns table (
  user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, updated_at timestamptz,
  battery int, accuracy_m double precision, sharing boolean, sharing_off_at timestamptz
)
language sql security definer set search_path = public as $$
  select l.user_id, u.name, u.photo_url, l.lat, l.lng, l.updated_at,
         l.battery, l.accuracy_m, l.sharing, l.sharing_off_at
  from circle_locations l
  join users_public u on u.id = l.user_id
  where l.user_id <> auth.uid()
    and public.shares_circle_with(l.user_id)
    and (
      (l.sharing and l.updated_at > now() - interval '1 day')
      or (not l.sharing and l.updated_at > now() - interval '7 days')
    )
  order by l.sharing desc, l.updated_at desc;
$$;

grant execute on function public.circle_members_locations() to authenticated;

-- Enable realtime so the Circle map updates live (RLS still applies: a client
-- only receives changes for rows it is allowed to read). Guarded so re-running
-- this file never errors on "table already in publication".
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'circle_locations'
  ) then
    alter publication supabase_realtime add table circle_locations;
  end if;
end $$;
