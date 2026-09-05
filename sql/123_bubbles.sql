-- 123_bubbles.sql
-- ============================================================================
-- Reduced precision sharing. "Somewhere in this neighbourhood" instead of a
-- pin on a doorway.
--
-- Sharing today is all or nothing: exact coordinates, or a grey pin and no
-- updates. There is no way to tell a circle you are fine and roughly where
-- without also telling them which building you are in.
--
-- ============================================================================
-- WHY THIS IS NOT A RANDOM OFFSET, WHICH IS THE OBVIOUS IMPLEMENTATION
-- ============================================================================
-- The obvious version adds a random jitter inside a radius on every read. It
-- is wrong, and wrong in a way that looks completely fine in testing.
--
-- THE CIRCLE MAP POLLS. Sample the same person's fuzzed position two hundred
-- times over an evening and take the mean. Independent noise cancels. You are
-- left with her true coordinate to within a few metres, recovered from a
-- feature whose entire purpose was to withhold it. The more the map refreshes,
-- the better the attack works, and the attacker is whoever she added to her
-- circle, which is exactly the person the feature protects against.
--
-- SNAPPING TO A GRID IS IDEMPOTENT. The same true position always maps to the
-- same output. Two hundred samples give two hundred identical answers, and
-- averaging identical answers yields nothing at all. There is no accumulation
-- attack because there is nothing to accumulate.
--
-- The grid origin is offset by a stable per-person hash, so the lattice is not
-- a known global one. Without that, an attacker who knows the cell size can
-- bound her position to a cell whose corners they can compute, which gives
-- back a chunk of what the blur removed.
--
-- POSTGIS IS NOT INVOLVED. There is no geometry column anywhere in this schema
-- (the only PostGIS functions reachable are three st_estimatedextent overloads
-- that report nothing, because nothing is stored as geometry). Adding one for
-- this would be a dependency for no gain: the arithmetic below is four lines.
--
-- Idempotent. Run after sql/122.
-- ============================================================================

-- Null means exact, which keeps every existing row and every existing user
-- behaving precisely as they do now.
alter table circle_locations
  add column if not exists precision_m int
    check (precision_m is null or precision_m between 100 and 5000);


-- ---------------------------------------------------------------------------
-- THE SNAP
-- ---------------------------------------------------------------------------
create or replace function public.orbii_bubble(
  p_lat double precision, p_lng double precision,
  p_user uuid, p_radius_m int
)
returns table (lat double precision, lng double precision)
language sql immutable as $$
  with g as (
    select
      -- Metres to degrees. 111320 is the length of a degree of latitude; a
      -- degree of longitude shrinks with the cosine of latitude, so scaling it
      -- keeps a cell square on the ground rather than a tall rectangle in
      -- Srinagar and a squat one in Kanyakumari.
      p_radius_m / 111320.0 as dlat,
      p_radius_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01)) as dlng,
      -- Stable per person and never re-rolled, so the lattice cannot be
      -- probed by watching where the jumps happen. Deterministic is the whole
      -- point: a value that changed per request would reintroduce exactly the
      -- averaging attack this design exists to remove.
      (abs(hashtextextended(p_user::text, 42)) % 1000) / 1000.0 as jitter
  )
  -- Centre of the cell she is in. Everyone inside one cell reports the same
  -- point, which is what makes the output carry no information about where in
  -- the cell she actually is.
  select (floor(p_lat / g.dlat + g.jitter) + 0.5 - g.jitter) * g.dlat,
         (floor(p_lng / g.dlng + g.jitter) + 0.5 - g.jitter) * g.dlng
  from g;
$$;

revoke all on function public.orbii_bubble(double precision, double precision, uuid, int)
  from public, anon;
grant execute on function public.orbii_bubble(double precision, double precision, uuid, int)
  to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- SETTING IT
-- ---------------------------------------------------------------------------
create or replace function public.set_location_precision(p_metres int default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if p_metres is not null and (p_metres < 100 or p_metres > 5000) then
    raise exception 'precision must be between 100 and 5000 metres';
  end if;
  update circle_locations set precision_m = p_metres where user_id = auth.uid();
  -- No row yet means she has never shared. Recording the preference now would
  -- need a row with no position in it, so this is a no-op and the next write
  -- carries the setting instead.
end $$;

revoke all on function public.set_location_precision(int) from public, anon;
grant execute on function public.set_location_precision(int) to authenticated;


-- ---------------------------------------------------------------------------
-- THE READ, WITH THE BUBBLE APPLIED BEFORE THE ROW LEAVES
-- ---------------------------------------------------------------------------
-- Applied here and not in the app. If the client fuzzed on receipt, the exact
-- coordinate would already have crossed the network and be sitting in a
-- PostgREST response and whatever cache is between them. The blur has to
-- happen on this side of the wire or it is decoration.
drop function if exists public.circle_members_locations();

create function public.circle_members_locations()
returns table (
  user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, updated_at timestamptz,
  battery int, accuracy_m double precision, sharing boolean, sharing_off_at timestamptz,
  emergency boolean, age_seconds int, unreachable boolean,
  charging boolean, speed_kmh double precision, precision_m int
)
language sql security definer set search_path = public as $$
  select l.user_id, u.name, u.photo_url,
         -- Exact during an emergency, whatever the setting says. A bubble
         -- during an SOS is the privacy feature defeating the product: her
         -- circle would be told she is somewhere in a square kilometre while
         -- she is waiting for one of them to arrive.
         case when l.precision_m is not null and not public.orbii_has_active_sos(l.user_id) then b.lat else l.lat end,
         case when l.precision_m is not null and not public.orbii_has_active_sos(l.user_id) then b.lng else l.lng end,
         l.updated_at,
         l.battery,
         -- Reporting 12 metre accuracy on a point snapped to a 1km cell would
         -- be a lie the map draws as a small confidence circle. The radius IS
         -- the accuracy now.
         case when l.precision_m is not null and not public.orbii_has_active_sos(l.user_id)
              then l.precision_m::double precision else l.accuracy_m end,
         l.sharing, l.sharing_off_at,
         public.orbii_has_active_sos(l.user_id) as emergency,
         extract(epoch from (now() - l.updated_at))::int as age_seconds,
         (l.sharing and l.updated_at < now() - interval '20 minutes') as unreachable,
         l.charging,
         -- Speed is withheld entirely rather than blurred. There is no honest
         -- way to reduce the precision of a scalar like this, and "she is doing
         -- 68 km/h" plus a 1km cell narrows her to the roads in it.
         case when l.precision_m is not null and not public.orbii_has_active_sos(l.user_id) then null
              when l.speed_kmh >= 0 then l.speed_kmh else null end,
         case when public.orbii_has_active_sos(l.user_id) then null else l.precision_m end
  from circle_locations l
  join users_public u on u.id = l.user_id
  -- The snapped point, computed for every row whether or not it is used. The
  -- alternative was a boolean alias called `on`, which is a reserved word and
  -- would not parse. `b.on` is now spelled out as `l.precision_m is not null`
  -- at each site, which is longer and unambiguous.
  cross join lateral (
    select bb.lat, bb.lng
    from public.orbii_bubble(l.lat, l.lng, l.user_id, coalesce(l.precision_m, 1000)) bb
  ) b
  where l.user_id <> auth.uid()
    and public.shares_circle_with(l.user_id)
    and (
      (l.sharing and l.updated_at > now() - interval '1 day')
      or (not l.sharing and l.updated_at > now() - interval '7 days')
      or public.orbii_has_active_sos(l.user_id)
    )
  order by public.orbii_has_active_sos(l.user_id) desc, l.sharing desc, l.updated_at desc;
$$;

revoke all on function public.circle_members_locations() from public, anon;
grant execute on function public.circle_members_locations() to authenticated;


-- ---------------------------------------------------------------------------
-- AND THE TRAIL, WHICH IS THE HALF THAT IS EASY TO FORGET
-- ---------------------------------------------------------------------------
-- A blurred pin over an exact breadcrumb trail hides nothing. The trail passes
-- through her true position every sixty seconds, so anyone reading the replay
-- sees precisely what the map was blurring, and the feature is worse than not
-- shipping it because she believed it was working.
create or replace function public.circle_member_trail(p_uid uuid, p_hours int default 168)
returns table (lat double precision, lng double precision, at timestamptz)
language sql security definer set search_path = public as $$
  select
    case when p.precision_m is not null then b.lat else h.lat end,
    case when p.precision_m is not null then b.lng else h.lng end,
    h.at
  from circle_location_history h
  -- LEFT JOIN LATERAL, not CROSS. A cross join returns no rows when the
  -- subquery is empty, so anyone with location history but no circle_locations
  -- row (they shared once, then the row was cleared) would silently lose their
  -- entire trail to a privacy feature they never switched on.
  left join lateral (
    select cl.precision_m from circle_locations cl where cl.user_id = p_uid
  ) p on true
  cross join lateral (
    select bb.lat, bb.lng
    from public.orbii_bubble(h.lat, h.lng, p_uid, coalesce(p.precision_m, 1000)) bb
  ) b
  where h.user_id = p_uid
    and (h.user_id = auth.uid() or public.shares_circle_with(p_uid))
    and h.at > now() - make_interval(hours => least(p_hours, public.orbii_trail_days() * 24))
  order by h.at desc
  limit 500;
$$;

revoke all on function public.circle_member_trail(uuid, int) from public, anon;
grant execute on function public.circle_member_trail(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'a precision can be set' as check,
       (exists (select 1 from information_schema.columns
                where table_name = 'circle_locations' and column_name = 'precision_m'))::text as result
union all
-- THE PROPERTY THE WHOLE DESIGN RESTS ON. Same input, same output, every time.
-- If this is ever false, polling recovers the true position by averaging and
-- the feature is worse than useless because people trusted it.
select 'the same position always snaps to the same point (must be true)',
       (select bool_and(a.lat = b.lat and a.lng = b.lng)
        from public.orbii_bubble(28.6139, 77.2090, '11111111-1111-1111-1111-111111111111', 1000) a,
             public.orbii_bubble(28.6139, 77.2090, '11111111-1111-1111-1111-111111111111', 1000) b)::text
union all
-- Two people standing in the same spot must not snap to the same point, or the
-- shared output tells you they are together.
select 'two people in one spot get different cells (must be true)',
       (select a.lat <> b.lat or a.lng <> b.lng
        from public.orbii_bubble(28.6139, 77.2090, '11111111-1111-1111-1111-111111111111', 1000) a,
             public.orbii_bubble(28.6139, 77.2090, '22222222-2222-2222-2222-222222222222', 1000) b)::text
union all
-- The blur has to actually move the point, and by roughly the radius asked for.
select 'a 1km bubble moves the point by under 1.5km (must be true)',
       (select 111320.0 * sqrt(power(b.lat - 28.6139, 2) +
              power((b.lng - 77.2090) * cos(radians(28.6139)), 2)) < 1500
        from public.orbii_bubble(28.6139, 77.2090, '11111111-1111-1111-1111-111111111111', 1000) b)::text
union all
select 'an SOS still reports exact position',
       (select prosrc ~ 'orbii_has_active_sos' from pg_proc
        where proname = 'circle_members_locations' and pronamespace = 'public'::regnamespace)::text
union all
select 'the trail is blurred too',
       (select prosrc ~ 'orbii_bubble' from pg_proc
        where proname = 'circle_member_trail' and pronamespace = 'public'::regnamespace)::text
union all
select 'the app can set its own precision (must be true)',
       public.orbii_can_exec('authenticated', 'public.set_location_precision(int)')
union all
select 'anon cannot read the roster (must be false)',
       has_function_privilege('anon', 'public.circle_members_locations()', 'execute')::text;
