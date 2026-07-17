-- 41_geofences.sql
-- ============================================================================
-- Safe zones. A circle member draws a zone around someone they love (home,
-- college, hostel). If that person LEAVES the zone, everyone who set a zone for
-- them gets notified, and the notification is stored so there's a history.
--
-- Consent matters here: this is location monitoring of another human being. A
-- zone can only be created for someone who SHARES A CIRCLE with you, so a
-- stranger can never fence you, and the fenced person can always see and delete
-- every zone set on them (policies below allow that explicitly).
-- ============================================================================

create table if not exists geofences (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade, -- who set it
  member_id   uuid not null references auth.users(id) on delete cascade, -- who is fenced
  label       text not null,
  lat         double precision not null,
  lng         double precision not null,
  radius_m    int not null default 300 check (radius_m between 100 and 5000),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create index if not exists geofences_member_idx on geofences (member_id, active);
create index if not exists geofences_owner_idx on geofences (owner_id);

alter table geofences enable row level security;

-- You may only fence someone you share a circle with. Never a stranger.
create or replace function public.shares_circle_with(p_other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from circle_members a
    join circle_members b on a.circle_id = b.circle_id
    where a.user_id = auth.uid() and b.user_id = p_other
  );
$$;
grant execute on function public.shares_circle_with(uuid) to authenticated;

drop policy if exists "geofence insert for circle" on geofences;
create policy "geofence insert for circle" on geofences
  for insert to authenticated
  with check (auth.uid() = owner_id and public.shares_circle_with(member_id));

-- Both sides can see a zone: the person who set it, AND the person it's set on.
-- The fenced person seeing it is the whole point — silent tracking is stalking.
drop policy if exists "geofence read both sides" on geofences;
create policy "geofence read both sides" on geofences
  for select to authenticated
  using (auth.uid() = owner_id or auth.uid() = member_id);

drop policy if exists "geofence update owner" on geofences;
create policy "geofence update owner" on geofences
  for update to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- Either side may delete it. The fenced person can always opt out.
drop policy if exists "geofence delete both sides" on geofences;
create policy "geofence delete both sides" on geofences
  for delete to authenticated
  using (auth.uid() = owner_id or auth.uid() = member_id);

-- ── Stored notifications ────────────────────────────────────────────────────
create table if not exists geofence_events (
  id          uuid primary key default gen_random_uuid(),
  geofence_id uuid not null references geofences(id) on delete cascade,
  member_id   uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('exit', 'enter')),
  lat         double precision,
  lng         double precision,
  created_at  timestamptz not null default now()
);

create index if not exists geofence_events_member_idx
  on geofence_events (member_id, created_at desc);

alter table geofence_events enable row level security;

-- The fenced person's device writes the event for itself.
drop policy if exists "geofence event insert self" on geofence_events;
create policy "geofence event insert self" on geofence_events
  for insert to authenticated with check (auth.uid() = member_id);

-- Readable by the fenced person and by whoever set that zone.
drop policy if exists "geofence event read" on geofence_events;
create policy "geofence event read" on geofence_events
  for select to authenticated
  using (
    auth.uid() = member_id
    or exists (
      select 1 from geofences g
      where g.id = geofence_id and g.owner_id = auth.uid()
    )
  );

-- Who should be pushed when a zone is crossed: everyone who set a zone on this
-- person (except the person themselves). Called by the notify-geofence function.
create or replace function public.geofence_watchers(p_geofence uuid)
returns table (user_id uuid)
language sql
security definer
set search_path = public
as $$
  select g.owner_id
  from geofences g
  where g.id = p_geofence and g.owner_id <> g.member_id;
$$;
grant execute on function public.geofence_watchers(uuid) to authenticated, service_role;
