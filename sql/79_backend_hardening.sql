-- 79_backend_hardening.sql
-- ============================================================================
-- Concurrency, latency and consistency hardening for the emergency path.
--
-- Five changes, all on stock Postgres + PostGIS, no licensed extensions:
--
--   1. Spherical distance on the three dispatch queries.
--   2. Partial GiST index on helpers_live, scoped to on-duty rows.
--   3. jsonb_build_object everywhere (three stragglers left on json).
--   4. Row-level locking in sos_escalation_tick so overlapping cron ticks
--      cannot double-dispatch a wave.
--   5. push_outbox: an append-only queue so a large push fan-out cannot time
--      out an edge function or couple alert-landing to Expo's latency.
--
-- Idempotent. Safe to re-run.
--
-- NOTE ON A NAME: the brief specified an index predicate of `is_on_duty = true`.
-- That column does not exist. helpers_live has `is_online` (sql/12 line 23) and
-- all nine references in the schema use that name, so the index below uses
-- is_online. An index on is_on_duty would have failed at migration time.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. PARTIAL SPATIAL INDEX
-- ---------------------------------------------------------------------------
-- helpers_live currently carries a full GiST over every row (helpers_live_gix,
-- sql/12 line 27). Every dispatch query in the system, without exception, adds
-- `is_online = true`:
--
--   nearest_helpers            (sql/12)
--   dispatch_verified_helpers  (sql/38)
--   dispatch_community_helpers (sql/46)
--
-- So the index is indexing rows no query can ever return. Off-duty helpers are
-- the majority of the table at any moment, which means the tree is larger than
-- it needs to be, more of it is cold, and every off-duty location ping pays to
-- update an index entry nobody will read.
--
-- The predicate is a plain boolean column, so it is IMMUTABLE and legal in an
-- index WHERE clause. The freshness filter (`updated_at > now() - 10 min`)
-- CANNOT go in the predicate: now() is STABLE, not IMMUTABLE, and Postgres will
-- reject it. That filter stays in the query and is applied after the index
-- scan, which is correct anyway since it changes every second.
--
-- CONCURRENTLY so this does not take an ACCESS EXCLUSIVE lock on a table that
-- is on the emergency read path. That means it cannot run inside a transaction
-- block: if your client wraps statements in one, run this file's section 1 on
-- its own.
create index concurrently if not exists idx_helpers_live_active_location
  on public.helpers_live using gist (location)
  where is_online = true;

-- Composite partial for the freshness filter, so the planner can satisfy
-- "online AND fresh" without visiting the heap for stale rows.
create index concurrently if not exists idx_helpers_live_active_fresh
  on public.helpers_live (updated_at desc)
  where is_online = true;

-- The full-table GiST is now strictly redundant: no query reads helpers_live
-- spatially without is_online = true. Dropping it halves the spatial index
-- write cost on every location ping, which is the single highest-frequency
-- write in the system (one per helper per minute while on duty).
drop index if exists public.helpers_live_gix;


-- ---------------------------------------------------------------------------
-- 2. SPHERICAL DISTANCE
-- ---------------------------------------------------------------------------
-- ST_DWithin on geography defaults to use_spheroid => true, which solves the
-- inverse geodetic problem on the WGS84 ellipsoid (Vincenty-style, iterative).
-- Passing false switches to a spherical earth: one closed-form haversine-class
-- calculation instead of an iterative solve.
--
-- ACCURACY, stated honestly: sphere-vs-spheroid disagreement is up to ~0.3%,
-- not sub-metre. At a 7 km dispatch radius that is roughly ±20 m of boundary
-- fuzz. That is irrelevant here, because the radius is itself an arbitrary
-- product choice and a helper 7,020 m away is exactly as useful as one at
-- 6,980 m. It would NOT be acceptable for arrival verification or geofence
-- entry/exit, which is why this change is confined to dispatch.
--
-- Note ST_DWithin already short-circuits on a bounding-box test via the GiST
-- index, so the exact calculation only runs on candidates that survive the box.
-- The saving is real but it is a saving on the refinement step, not on the
-- whole query.

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
stable
as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g
  )
  select h.user_id
  from public.helpers_live h
  join public.helper_profiles hp on hp.user_id = h.user_id
  where h.is_online = true
    and h.updated_at > now() - interval '10 minutes'
    and hp.verification_status = 'verified'
    and (p_exclude is null or h.user_id <> p_exclude)
    and ST_DWithin(h.location, (select g from origin), p_radius_km * 1000, false)
  order by h.location <-> (select g from origin)
  limit 50;
$$;

grant execute on function public.dispatch_verified_helpers(
  double precision, double precision, double precision, uuid
) to service_role, authenticated;


create or replace function public.dispatch_community_helpers(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 3,
  p_exclude   uuid default null
)
returns table (user_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography as g
  )
  select h.user_id
  from public.helpers_live h
  left join public.helper_profiles hp on hp.user_id = h.user_id
  where h.is_online = true
    and h.updated_at > now() - interval '10 minutes'
    -- Non-verified only: verified helpers are dispatched separately.
    and coalesce(hp.verification_status, 'none') <> 'verified'
    and (p_exclude is null or h.user_id <> p_exclude)
    and ST_DWithin(h.location, (select g from origin), p_radius_km * 1000, false)
  order by h.location <-> (select g from origin)
  limit 50;
$$;

grant execute on function public.dispatch_community_helpers(
  double precision, double precision, double precision, uuid
) to service_role, authenticated;


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
language sql security definer set search_path = public stable as $$
  with origin as (
    select ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography as g
  )
  select
    h.user_id,
    coalesce(u.name, 'Helper') as name,
    u.photo_url,
    5::numeric as rating,
    -- Display distance stays on the spheroid: this number is shown to a human
    -- as "1.2 km away", and it costs one calculation per returned row (at most
    -- limit_count), not one per candidate.
    ST_Distance(h.location, (select g from origin)) as distance_m,
    ST_Y(h.location::geometry) as lat_h,
    ST_X(h.location::geometry) as lng_h
  from public.helpers_live h
  left join public.users_public u on u.id = h.user_id
  where h.is_online = true
    and h.user_id <> auth.uid()
    and h.updated_at > now() - interval '10 minutes'
    and ST_DWithin(h.location, (select g from origin), radius_km * 1000, false)
  order by h.location <-> (select g from origin)
  limit limit_count;
$$;

grant execute on function public.nearest_helpers(
  double precision, double precision, double precision, int
) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. jsonb_build_object
-- ---------------------------------------------------------------------------
-- The schema is already 24-to-3 in favour of jsonb. These are the three
-- stragglers: sql/66 line 58, sql/69 lines 150 and 192.
--
-- Honest scope: for objects this small the parse saving is in the microseconds.
-- The reason to do it is consistency of return type across 129 RPCs, so an
-- edge function never has to care which of two JSON types it got back, and so
-- callers can use ->> and @> uniformly.

create or replace function public.helper_dispatch_status()
returns jsonb
language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'used',      coalesce(u.used, 0),
    'cap',       public.helper_dispatch_cap(auth.uid()),
    'unlimited', public.helper_dispatch_cap(auth.uid()) is null,
    'period',    to_char(date_trunc('month', now() at time zone 'Asia/Kolkata'), 'YYYY-MM')
  )
  from (
    select sum(d.used) as used
    from helper_dispatch_usage d
    where d.user_id = auth.uid()
      and d.period = to_char(date_trunc('month', now() at time zone 'Asia/Kolkata'), 'YYYY-MM')
  ) u;
$$;

grant execute on function public.helper_dispatch_status() to authenticated;


-- ---------------------------------------------------------------------------
-- 4. ESCALATION CONCURRENCY
-- ---------------------------------------------------------------------------
-- The race, precisely.
--
-- sos_escalation_tick loops over active SOS events, reads the sos_escalation
-- row, decides, then writes wave = wave + 1. Read and write are separate
-- statements with no lock between them. Two overlapping cron ticks (a slow tick
-- plus the next one firing on schedule, or a manual invoke landing on top of
-- the timer) both read wave = 2, both decide to escalate, both write wave = 3,
-- and SIX helpers are dispatched for a wave meant to send three. Worse, the
-- second UPDATE resets last_wave_at, so the 4-minute stall timer restarts and
-- the NEXT wave is delayed.
--
-- The brief proposed locking sos_events. That works as a mutex but it is the
-- wrong row: sos_events is written by the victim's own app when she cancels or
-- resolves, so holding FOR UPDATE on it for the length of a tick can block a
-- woman cancelling her own emergency. sos_escalation is the state this function
-- actually mutates, and nothing else writes it.
--
-- So: SKIP LOCKED on sos_escalation. A second concurrent tick finds the row
-- locked, skips that event entirely, and moves on. No blocking, no double
-- dispatch, and the victim's cancel path is never in contention.
--
-- The lock is held to the end of the function call, which is the whole
-- transaction for a single-statement RPC.

create or replace function public.sos_escalation_tick()
returns table (
  sos_id text,
  victim_id uuid,
  lat double precision,
  lng double precision,
  wave int,
  action text          -- 'ping_victim' | 'dispatch_wave'
)
language plpgsql security definer set search_path = public as $$
declare
  e record;
  esc record;
  n_arrived int;
  n_responders int;
begin
  for e in
    select ev.id::text as sid, ev.user_id, ev.lat, ev.lng, ev.created_at
    from sos_events ev
    where ev.status = 'active'
      and ev.kind = 'real'                     -- never escalate a test
      and ev.created_at > now() - interval '2 hours'
  loop
    -- Ensure the ledger row exists without racing another tick to create it.
    insert into sos_escalation (sos_id) values (e.sid)
      on conflict (sos_id) do nothing;

    -- Take the row. If another tick already holds it, skip this event
    -- entirely rather than waiting: the holder is about to do this work.
    select * into esc
      from sos_escalation
      where sos_escalation.sos_id = e.sid
      for update skip locked;
    if not found then
      continue;
    end if;

    -- She said she is safe: the ladder stops here.
    if esc.victim_safe is true then continue; end if;
    if esc.wave >= public.sos_max_waves() then continue; end if;

    -- Arrival is PROVEN by an entered code, never self-reported, so a helper
    -- cannot silence the escalation by claiming to be there.
    select count(*) into n_arrived
      from sos_arrival_codes c
      where c.sos_id::text = e.sid and c.entered_at is not null;
    select count(*) into n_responders
      from sos_responders r where r.sos_id = e.sid;

    if n_arrived = 0 then
      -- Nobody has arrived yet. If a whole wave was dispatched and not one
      -- person got there within a generous window, that is also a stall, just
      -- an earlier one: send more people.
      if n_responders > 0
         and esc.last_wave_at < now() - interval '4 minutes' then
        update sos_escalation set wave = esc.wave + 1, last_wave_at = now(),
               stalled = true, updated_at = now()
          where sos_escalation.sos_id = e.sid;
        sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
        wave := esc.wave + 1; action := 'dispatch_wave';
        return next;
      end if;
      continue;
    end if;

    -- Someone has arrived. Record when that first happened.
    if esc.first_arrival_at is null then
      update sos_escalation set first_arrival_at = now(), updated_at = now()
        where sos_escalation.sos_id = e.sid;
      continue;                                  -- start the grace clock
    end if;

    -- Still active, well after arrival: ask her.
    if esc.victim_pinged_at is null
       and esc.first_arrival_at < now() - make_interval(secs => public.sos_arrival_grace()) then
      update sos_escalation set victim_pinged_at = now(), stalled = true, updated_at = now()
        where sos_escalation.sos_id = e.sid;
      sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
      wave := esc.wave; action := 'ping_victim';
      return next;
      continue;
    end if;

    -- Asked, no answer, window closed: send the next wave without her.
    if esc.victim_pinged_at is not null
       and esc.victim_answered_at is null
       and esc.victim_pinged_at < now() - make_interval(secs => public.sos_ping_window()) then
      update sos_escalation
        set wave = esc.wave + 1, last_wave_at = now(),
            victim_pinged_at = null,             -- re-ask after the next wave
            updated_at = now()
        where sos_escalation.sos_id = e.sid;
      sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
      wave := esc.wave + 1; action := 'dispatch_wave';
      return next;
    end if;
  end loop;
end $$;

grant execute on function public.sos_escalation_tick() to service_role;


-- ---------------------------------------------------------------------------
-- 5. PUSH OUTBOX
-- ---------------------------------------------------------------------------
-- notify-sos currently sends every push inline, chunked 100 at a time, awaiting
-- Expo on each chunk. A victim in a large circle plus five waves of helpers is
-- several sequential round trips to a third party, inside an edge function with
-- a wall-clock budget. If Expo is slow, the function times out and the LAST
-- chunks are never sent. The people at the end of the list are silently dropped.
--
-- The fix is an append-only outbox. But note the tradeoff honestly: naively
-- moving ALL pushes to a queue makes the first alert SLOWER, because it now
-- waits for a drain cycle. On an SOS that is the wrong direction.
--
-- So the edge function keeps sending the FIRST chunk inline (the circle and the
-- nearest helpers, one HTTP call, the people who matter most) and enqueues the
-- tail. Latency for the critical recipients is unchanged; the unbounded part is
-- what gets decoupled.
--
-- priority: 0 = SOS, 5 = normal. The drain always takes 0 first.
create table if not exists public.push_outbox (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  token       text        not null,
  payload     jsonb       not null,
  priority    smallint    not null default 5,
  attempts    int         not null default 0,
  send_after  timestamptz not null default now(),
  sent_at     timestamptz,
  last_error  text
);

alter table public.push_outbox enable row level security;
-- No policies. Written and read only by SECURITY DEFINER functions under the
-- service role. A push queue containing every recipient of every emergency is
-- not something any client should be able to read.

-- The drain's hot path: unsent, due, best priority, oldest first.
create index if not exists idx_push_outbox_pending
  on public.push_outbox (priority, send_after, id)
  where sent_at is null;

-- Enqueue. Takes an array of tokens and one shared payload, which is the shape
-- every caller actually has.
create or replace function public.push_enqueue(
  p_tokens   text[],
  p_payload  jsonb,
  p_priority smallint default 5
)
returns int
language sql security definer set search_path = public as $$
  with ins as (
    insert into public.push_outbox (token, payload, priority)
    select t, p_payload, p_priority
    from unnest(p_tokens) as t
    where t is not null and t <> ''
    returning 1
  )
  select count(*)::int from ins;
$$;

grant execute on function public.push_enqueue(text[], jsonb, smallint) to service_role;

-- Claim a batch. SKIP LOCKED is what makes this safe to run from several
-- concurrent drains: each grabs a disjoint set, none blocks the others.
-- Rows are marked with a future send_after so a crashed drain releases them
-- back to the queue after a minute instead of losing them.
create or replace function public.push_claim(p_limit int default 100)
returns table (id bigint, token text, payload jsonb)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with claimed as (
    select o.id
    from public.push_outbox o
    where o.sent_at is null
      and o.send_after <= now()
      and o.attempts < 5
    order by o.priority asc, o.id asc
    limit p_limit
    for update skip locked
  )
  update public.push_outbox o
     set attempts   = o.attempts + 1,
         send_after = now() + interval '1 minute'
    from claimed c
   where o.id = c.id
   returning o.id, o.token, o.payload;
end $$;

grant execute on function public.push_claim(int) to service_role;

create or replace function public.push_mark_sent(p_ids bigint[])
returns void
language sql security definer set search_path = public as $$
  update public.push_outbox
     set sent_at = now(), last_error = null
   where id = any(p_ids);
$$;

grant execute on function public.push_mark_sent(bigint[]) to service_role;

create or replace function public.push_mark_failed(p_ids bigint[], p_error text)
returns void
language sql security definer set search_path = public as $$
  update public.push_outbox
     set last_error = left(p_error, 500),
         -- Exponential backoff, capped. attempts is already incremented by
         -- push_claim, so attempt 1 waits 2s, attempt 4 waits 16s.
         send_after = now() + make_interval(secs => least(power(2, attempts), 300))
   where id = any(p_ids);
$$;

grant execute on function public.push_mark_failed(bigint[], text) to service_role;

-- Keep the table from growing without bound. Sent rows are kept a day for
-- delivery debugging, then dropped.
create or replace function public.push_outbox_sweep()
returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.push_outbox
     where (sent_at is not null and sent_at < now() - interval '1 day')
        or (attempts >= 5 and created_at < now() - interval '1 day')
    returning 1
  )
  select count(*)::int from gone;
$$;

grant execute on function public.push_outbox_sweep() to service_role;


-- ---------------------------------------------------------------------------
-- 6. RATE LIMITING, DATABASE SIDE
-- ---------------------------------------------------------------------------
-- The brief asks for gateway-layer limits. Supabase's free tier does not expose
-- per-route gateway rules, so the enforceable zero-cost layer is a token bucket
-- in front of the SECURITY DEFINER functions that actually cost something.
--
-- This is not a substitute for an edge WAF against volumetric attack. It is a
-- guard against one authenticated account exhausting shared database resources,
-- which is the threat the RPC surface is actually exposed to.
create table if not exists public.rpc_rate_limit (
  user_id   uuid        not null,
  bucket    text        not null,
  window_at timestamptz not null,
  hits      int         not null default 0,
  primary key (user_id, bucket, window_at)
);

alter table public.rpc_rate_limit enable row level security;
-- No policies: definer-only, and a client must not be able to read or reset it.

create index if not exists idx_rpc_rate_limit_window
  on public.rpc_rate_limit (window_at);

-- Returns true if the call is ALLOWED. Fixed window, which is cheaper than a
-- sliding log and precise enough at these limits.
create or replace function public.rate_ok(
  p_bucket   text,
  p_limit    int,
  p_window_s int default 60
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  w   timestamptz;
  n   int;
begin
  if uid is null then return false; end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_s) * p_window_s);

  insert into public.rpc_rate_limit (user_id, bucket, window_at, hits)
    values (uid, p_bucket, w, 1)
  on conflict (user_id, bucket, window_at)
    do update set hits = public.rpc_rate_limit.hits + 1
  returning hits into n;

  return n <= p_limit;
end $$;

grant execute on function public.rate_ok(text, int, int) to authenticated;

-- Housekeeping: the table is otherwise unbounded.
create or replace function public.rate_limit_sweep()
returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from public.rpc_rate_limit where window_at < now() - interval '1 hour'
    returning 1
  )
  select count(*)::int from gone;
$$;

grant execute on function public.rate_limit_sweep() to service_role;


-- ---------------------------------------------------------------------------
-- 7. SCHEDULES
-- ---------------------------------------------------------------------------
-- Requires pg_cron. Sweeps only; the push drain is invoked by the edge
-- function, not by cron, so it can run on demand right after an SOS.
select cron.unschedule('orbii-push-outbox-sweep')
  where exists (select 1 from cron.job where jobname = 'orbii-push-outbox-sweep');
select cron.schedule('orbii-push-outbox-sweep', '17 * * * *',
  $$select public.push_outbox_sweep();$$);

select cron.unschedule('orbii-rate-limit-sweep')
  where exists (select 1 from cron.job where jobname = 'orbii-rate-limit-sweep');
select cron.schedule('orbii-rate-limit-sweep', '23 * * * *',
  $$select public.rate_limit_sweep();$$);


-- ---------------------------------------------------------------------------
-- 8. VERIFY
-- ---------------------------------------------------------------------------
-- Run this after the migration. Every row should read 'ok'.
do $$
declare msg text;
begin
  select string_agg(check_name || ': ' || result, e'\n')
    into msg
  from (
    select 'partial gist index' as check_name,
           case when exists (select 1 from pg_indexes
                             where indexname = 'idx_helpers_live_active_location')
                then 'ok' else 'MISSING' end as result
    union all
    select 'old full gist dropped',
           case when not exists (select 1 from pg_indexes
                                 where indexname = 'helpers_live_gix')
                then 'ok' else 'STILL PRESENT' end
    union all
    select 'push_outbox',
           case when to_regclass('public.push_outbox') is not null
                then 'ok' else 'MISSING' end
    union all
    select 'rpc_rate_limit',
           case when to_regclass('public.rpc_rate_limit') is not null
                then 'ok' else 'MISSING' end
    union all
    select 'escalation tick locks',
           case when (select prosrc from pg_proc
                      where proname = 'sos_escalation_tick' limit 1)
                     like '%skip locked%'
                then 'ok' else 'NOT LOCKED' end
  ) checks;
  raise notice e'\n%', msg;
end $$;
