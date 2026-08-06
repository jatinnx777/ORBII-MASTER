-- 69_responder_slots.sql --- Uber-style responder matching + no-show recovery.
--
-- PROBLEM this fixes:
--   1) Everyone who accepts an SOS used to get in (50 helpers -> a mob, and you
--      can't pay 50 people for one help).
--   2) Escalation stopped the instant ANYONE accepted, so a helper who accepted
--      then ghosted / went the wrong way silently killed the whole response.
--
-- SOLUTION:
--   * Only the best K=3 accepters get a "slot" (a match score decides).
--   * A recovery loop (pg_cron) frees the slot of anyone who isn't actually
--     coming, promotes the next-best standby, and re-broadcasts when starved,
--     so help keeps flowing until someone is truly on the way.
--
-- Idempotent. Depends on sql/33 (rescue_events), sql/38 (helpers_live), sql/66
-- (helper caps). Run this whole file on Supabase.

-- 0. Schema -----------------------------------------------------------------
alter table public.rescue_events
  add column if not exists match_score numeric,
  add column if not exists slot        int,
  add column if not exists status      text not null default 'assigned';
  -- status: 'assigned' (in one of the 3 slots) | 'standby' (accepted, waiting)
  --         | 'preempted' (dropped: outbid or no-show) | 'cancelled'

-- Throttle for re-broadcasts so a starved SOS re-pushes at most every ~90s.
alter table public.sos_events
  add column if not exists last_rebroadcast_at timestamptz;

-- 1. Reliability: did this helper actually ARRIVE when they accepted before? ---
create or replace function public.helper_reliability(p_uid uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  with h as (
    select arrived_at
    from public.rescue_events
    where helper_id = p_uid and status <> 'standby'
    order by accepted_at desc
    limit 20
  )
  select case
    when count(*) < 3 then 0.7   -- new helper: benefit of the doubt
    else (count(*) filter (where arrived_at is not null))::numeric / count(*)
  end
  from h;
$$;

-- 2. The match score (0..100). Higher = better pick. -------------------------
--    50% proximity, 25% trust, 15% reliability, 10% responsiveness,
--    minus a fairness penalty if already on another active mission.
create or replace function public.rescue_match_score(
  p_uid uuid,
  p_lat double precision,
  p_lng double precision,
  p_accept_latency int
)
returns numeric
language plpgsql stable security definer set search_path = public
as $$
declare
  dist_km     numeric;
  proximity   numeric;
  trust       numeric;
  reliability numeric;
  speed       numeric;
  penalty     numeric := 0;
begin
  select ST_Distance(h.location, ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography) / 1000.0
    into dist_km
  from public.helpers_live h
  where h.user_id = p_uid;

  proximity := greatest(0, least(1, 1 - coalesce(dist_km, 5) / 5.0));

  select least(1, greatest(0, coalesce(trust_score, 0) / 100.0)) into trust
  from public.helper_profiles where user_id = p_uid;
  trust := coalesce(trust, 0);

  reliability := public.helper_reliability(p_uid);
  speed := greatest(0, least(1, 1 - coalesce(p_accept_latency, 0)::numeric / 60.0));

  if exists (
    select 1
    from public.rescue_events re
    join public.sos_events s on s.id = re.sos_id
    where re.helper_id = p_uid and re.status = 'assigned'
      and s.status = 'active' and re.arrived_at is null
  ) then
    penalty := 15;
  end if;

  return round(
    100 * (0.50 * proximity + 0.25 * trust + 0.15 * reliability + 0.10 * speed)
    - penalty + (random() * 2 - 1),  -- tiny jitter breaks ties fairly
    2
  );
end;
$$;

-- 3. Claim a slot (the new accept path). Atomic per-SOS so 50 concurrent -------
--    accepts can never over-fill the 3 slots. Enforces the monthly cap (sql/66).
create or replace function public.rescue_claim(
  p_sos uuid,
  p_victim uuid,
  p_sos_created timestamptz,
  p_device text,
  p_mock boolean
)
returns json
language plpgsql security definer set search_path = public
as $$
declare
  uid uuid := auth.uid();
  existing public.rescue_events%rowtype;
  s public.sos_events%rowtype;
  latency int;
  my_score numeric;
  assigned_count int;
  weakest public.rescue_events%rowtype;
  new_slot int;
  new_status text;
  cap int; used int;
  ev_id uuid;
begin
  if uid is null then raise exception 'auth required'; end if;

  select * into s from public.sos_events where id = p_sos;
  if s.id is null then raise exception 'sos not found'; end if;

  -- Serialize every claim for THIS sos so slot counting is race-free.
  perform pg_advisory_xact_lock(hashtext(p_sos::text));

  select * into existing from public.rescue_events where sos_id = p_sos and helper_id = uid;

  -- Monthly cap only bites a brand-new rescue (sql/66).
  if existing.id is null then
    cap  := public.helper_monthly_cap(uid);
    used := public.helper_helps_this_month(uid);
    if used >= cap then
      raise exception 'monthly_help_limit_reached' using errcode = 'P0001';
    end if;
  end if;

  -- Already holding a slot? Just refresh the score and return it.
  if existing.id is not null and existing.status = 'assigned' then
    latency := existing.accept_latency_sec;
    my_score := public.rescue_match_score(uid, s.lat, s.lng, latency);
    update public.rescue_events set match_score = my_score where id = existing.id;
    return json_build_object('id', existing.id, 'status', 'assigned', 'slot', existing.slot);
  end if;

  latency := greatest(0, extract(epoch from (now() - coalesce(p_sos_created, now())))::int);
  my_score := public.rescue_match_score(uid, s.lat, s.lng, latency);

  select count(*) into assigned_count
  from public.rescue_events where sos_id = p_sos and status = 'assigned';

  if assigned_count < 3 then
    new_slot := assigned_count + 1;
    new_status := 'assigned';
  else
    -- Preempt the weakest assigned holder who HASN'T started moving yet.
    select * into weakest from public.rescue_events
    where sos_id = p_sos and status = 'assigned' and first_moved_at is null
    order by match_score asc nulls first
    limit 1;

    if weakest.id is not null and my_score > coalesce(weakest.match_score, -1) + 5 then
      update public.rescue_events set status = 'preempted', slot = null where id = weakest.id;
      new_slot := weakest.slot;
      new_status := 'assigned';
    else
      new_slot := null;
      new_status := 'standby';
    end if;
  end if;

  if existing.id is null then
    insert into public.rescue_events
      (sos_id, helper_id, victim_id, accept_latency_sec, device_id, mock_location, match_score, slot, status)
    values
      (p_sos, uid, p_victim, latency, p_device, coalesce(p_mock, false), my_score, new_slot, new_status)
    returning id into ev_id;
  else
    update public.rescue_events
      set match_score = my_score, slot = new_slot, status = new_status, device_id = p_device
      where id = existing.id
    returning id into ev_id;
  end if;

  return json_build_object('id', ev_id, 'status', new_status, 'slot', new_slot);
end;
$$;

grant execute on function public.helper_reliability(uuid) to authenticated;
grant execute on function public.rescue_match_score(uuid, double precision, double precision, int) to authenticated, service_role;
grant execute on function public.rescue_claim(uuid, uuid, timestamptz, text, boolean) to authenticated;

-- 4. No-show recovery: runs every 30s while any SOS is active. ----------------
create or replace function public.rescue_recover()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  sos record;
  open_slots int;
  cand public.rescue_events%rowtype;
  next_slot int;
begin
  for sos in
    select id, last_rebroadcast_at
    from public.sos_events
    where status = 'active' and created_at > now() - interval '30 minutes'
  loop
    -- (a) Drop no-shows: assigned, but never started moving after a 90s grace.
    update public.rescue_events
    set status = 'preempted', slot = null
    where sos_id = sos.id and status = 'assigned'
      and arrived_at is null and first_moved_at is null
      and accepted_at < now() - interval '90 seconds';

    -- (b) Fill freed slots with the best standby helpers.
    select 3 - count(*) into open_slots
    from public.rescue_events where sos_id = sos.id and status = 'assigned';

    while open_slots > 0 loop
      select * into cand from public.rescue_events
      where sos_id = sos.id and status = 'standby'
      order by match_score desc nulls last
      limit 1;
      exit when cand.id is null;
      select coalesce(max(slot), 0) + 1 into next_slot
      from public.rescue_events where sos_id = sos.id and status = 'assigned';
      update public.rescue_events set status = 'assigned', slot = next_slot where id = cand.id;
      open_slots := open_slots - 1;
    end loop;

    -- (c) Starved (nobody assigned, nobody on standby) --- re-broadcast, throttled.
    if not exists (select 1 from public.rescue_events where sos_id = sos.id and status = 'assigned')
       and not exists (select 1 from public.rescue_events where sos_id = sos.id and status = 'standby')
       and (sos.last_rebroadcast_at is null or sos.last_rebroadcast_at < now() - interval '90 seconds')
    then
      update public.sos_events set last_rebroadcast_at = now() where id = sos.id;
      -- IMPORTANT: paste the SAME Authorization Bearer value used in sql/58
      -- (the project anon key) in place of the placeholder below before running.
      perform net.http_post(
        url := 'https://henbkyjefhzmxqozlczd.supabase.co/functions/v1/notify-sos',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlbmJreWplZmh6bXhxb3psY3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDkzNjksImV4cCI6MjA5MjEyNTM2OX0.JpNZwyzD75f75C8FNztE8_GMDAJKI-UKJMps6larhcA'
        ),
        body := jsonb_build_object('sosId', sos.id)
      );
    end if;
  end loop;
end;
$$;

-- Every 30 seconds. (Supabase pg_cron supports sub-minute schedules.)
select cron.unschedule('orbii-rescue-recover')
where exists (select 1 from cron.job where jobname = 'orbii-rescue-recover');
select cron.schedule('orbii-rescue-recover', '30 seconds', $$ select public.rescue_recover(); $$);
