-- 78_sos_escalation.sql
-- ============================================================================
-- Escalation waves: never let an SOS quietly stall.
--
-- THE FAILURE THIS CLOSES
-- Three helpers accept, all three physically arrive, and then nothing happens.
-- Nobody marks her helped. From the server's point of view the SOS looks like a
-- success: people were dispatched, people arrived. From hers, three strangers
-- turned up and the emergency is still live.
--
-- That is the worst state the system can be in, because it looks handled. The
-- old flow had no way to notice it. Once helpers were dispatched there was no
-- further check, so an SOS could sit "active" indefinitely with everyone
-- assuming someone else had it.
--
-- THE LADDER
--   1. A wave of 3 is dispatched.
--   2. They arrive (an arrival code is entered, so arrival is proven, not
--      self-reported).
--   3. If the SOS is still active GRACE seconds after the first arrival, ask
--      HER directly: "are you safe?"
--   4. If she does not answer within PING_WINDOW, do not wait for her. Dispatch
--      the next wave of 3.
--   5. Repeat until she is safe, someone marks her helped, or we run out of
--      people.
--
-- WHY SILENCE MEANS ESCALATE, NOT STOP
-- A woman who cannot answer her phone is the exact person who needs the next
-- wave. Reading no-answer as "probably fine" gets that backwards, so silence
-- always escalates. The cost of being wrong is three more people arriving at
-- someone who was already okay. The cost of the opposite is unbounded.
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tunables in one place, so they are arguable rather than buried.
-- ---------------------------------------------------------------------------
create or replace function public.sos_wave_size() returns int
language sql immutable as $$ select 3 $$;
-- Seconds after the first proven arrival before we start worrying. Long enough
-- for a helper to reach her and mark it; short enough that nobody stands around.
create or replace function public.sos_arrival_grace() returns int
language sql immutable as $$ select 90 $$;
-- How long she gets to answer "are you safe?" before we escalate anyway.
create or replace function public.sos_ping_window() returns int
language sql immutable as $$ select 45 $$;
-- A ceiling, so a forgotten test SOS cannot page an entire city all night.
create or replace function public.sos_max_waves() returns int
language sql immutable as $$ select 5 $$;

-- ---------------------------------------------------------------------------
-- 2. State per SOS.
-- ---------------------------------------------------------------------------
create table if not exists sos_escalation (
  sos_id             text primary key,
  wave               int not null default 1,
  first_arrival_at   timestamptz,
  victim_pinged_at   timestamptz,
  victim_answered_at timestamptz,
  victim_safe        boolean,
  last_wave_at       timestamptz not null default now(),
  stalled            boolean not null default false,
  updated_at         timestamptz not null default now()
);

alter table sos_escalation enable row level security;

-- Only the victim reads her own escalation state. Helpers must not be able to
-- see that a wave is being escalated: knowing the system is about to send more
-- people is an invitation to stall.
drop policy if exists "esc read victim" on sos_escalation;
create policy "esc read victim" on sos_escalation
  for select to authenticated
  using (exists (select 1 from sos_events e
                 where e.id::text = sos_escalation.sos_id and e.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. "I am safe" / "I still need help", from the victim's phone.
--
-- Answering safe does NOT resolve the SOS on its own. It stops the escalation
-- ladder; closing the emergency stays a deliberate, separate act, because a
-- mis-tap must never be able to call off help.
-- ---------------------------------------------------------------------------
create or replace function public.sos_answer_safety_check(p_sos text, p_safe boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from sos_events e
                 where e.id::text = p_sos and e.user_id = auth.uid()) then
    raise exception 'not your SOS';
  end if;
  insert into sos_escalation (sos_id, victim_answered_at, victim_safe, updated_at)
    values (p_sos, now(), p_safe, now())
  on conflict (sos_id) do update
    set victim_answered_at = now(), victim_safe = p_safe, updated_at = now();
end $$;

grant execute on function public.sos_answer_safety_check(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The tick. Returns the SOS events that need action right now, so the
--    edge function can send the pings and dispatch the waves.
--
-- Kept as a read plus a state write, with the actual notifying done outside,
-- because push delivery does not belong in a database transaction.
-- ---------------------------------------------------------------------------
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
    select * into esc from sos_escalation where sos_escalation.sos_id = e.sid;
    if not found then
      insert into sos_escalation (sos_id) values (e.sid);
      select * into esc from sos_escalation where sos_escalation.sos_id = e.sid;
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

-- ---------------------------------------------------------------------------
-- 5. Who to send next.
--
-- Excludes anyone already dispatched to this SOS, so wave 2 is three NEW
-- people rather than the same three being asked again. Verification is not
-- required: an ordinary user nearby who is willing to come is worth more than a
-- verified helper who is not.
-- ---------------------------------------------------------------------------
create or replace function public.next_wave_helpers(
  p_sos text, p_lat double precision, p_lng double precision, p_limit int default 3
)
returns table (user_id uuid, distance_m double precision)
language sql security definer set search_path = public stable as $$
  select hl.user_id,
         st_distance(hl.location, st_point(p_lng, p_lat)::geography) as distance_m
  from helpers_live hl
  where hl.is_online
    and hl.updated_at > now() - interval '15 minutes'
    and hl.user_id <> (select e.user_id from sos_events e where e.id::text = p_sos)
    and not exists (select 1 from sos_responders r
                    where r.sos_id = p_sos and r.user_id = hl.user_id)
    and st_dwithin(hl.location, st_point(p_lng, p_lat)::geography, 3000)
  order by distance_m
  limit greatest(1, p_limit);
$$;

-- ---------------------------------------------------------------------------
-- 6. What the victim's app shows: is a safety check outstanding?
-- ---------------------------------------------------------------------------
create or replace function public.my_safety_check(p_sos text)
returns table (pending boolean, wave int, arrived int)
language sql security definer set search_path = public stable as $$
  select
    (esc.victim_pinged_at is not null and esc.victim_answered_at is null),
    esc.wave,
    (select count(*)::int from sos_arrival_codes c
      where c.sos_id::text = p_sos and c.entered_at is not null)
  from sos_escalation esc
  where esc.sos_id = p_sos
    and exists (select 1 from sos_events e
                where e.id::text = p_sos and e.user_id = auth.uid());
$$;

grant execute on function public.my_safety_check(text) to authenticated;
