-- 89_dispatch_wave_cap.sql
-- ============================================================================
-- Cap concurrent responders per SOS, and backfill the wave when one drops out.
--
-- THE CAP IS NOT A NEW NUMBER. sos_wave_size() already exists in sql/78 and
-- already returns 3; it is what decides how many people a wave invites. Adding
-- a second constant for how many may ACCEPT would let the two drift, and the
-- day they drift is the day we invite three and admit five. Everything here
-- reads sos_wave_size().
--
-- WHY A CAP AT ALL. Twenty people converging on a woman in a car park is not
-- twenty times the help. It is a crowd she cannot read, in the dark, when she is
-- already frightened. Three is a number she can look at and count.
--
-- ENFORCED IN THREE PLACES, ON PURPOSE:
--   * next_wave_helpers() clamps the invite to free slots, so we do not page
--     three people for one opening and hand two of them a rejection.
--   * accept_sos_dispatch() is the front door: it locks, checks, and returns a
--     sentence a human can read.
--   * a BEFORE INSERT trigger on sos_responders is the actual boundary, because
--     the shipping client (services/community.ts respondToAlert) inserts into
--     that table directly and RLS lets it.
--
-- Idempotent. Run after sql/78.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. A RESPONDER CAN NOW LEAVE
-- ---------------------------------------------------------------------------
-- Accepting was previously a one-way door: a row in sos_responders and no way
-- to say "I cannot make it after all". So a helper who accepted and then got
-- stuck held a slot forever, and the victim's screen counted somebody who was
-- never coming.
alter table sos_responders
  add column if not exists left_at     timestamptz,
  add column if not exists left_reason text,
  add column if not exists wave        int;

-- Duplicates first. The table never had a uniqueness rule, so the same helper
-- could hold several slots and inflate the count against the cap. Keep the
-- earliest row, which is the accept that actually happened.
update sos_responders r
   set left_at = now(), left_reason = 'duplicate_row'
 where left_at is null
   and exists (
     select 1 from sos_responders keep
     where keep.sos_id = r.sos_id
       and keep.user_id = r.user_id
       and keep.left_at is null
       and (keep.created_at, keep.id) < (r.created_at, r.id)
   );

drop index if exists sos_responders_live_uq;
create unique index sos_responders_live_uq
  on sos_responders (sos_id, user_id)
  where left_at is null;

create index if not exists sos_responders_live_idx
  on sos_responders (sos_id) where left_at is null;

-- ---------------------------------------------------------------------------
-- 2. HOW MANY ARE ACTUALLY COMING
-- ---------------------------------------------------------------------------
-- One definition, used by the clamp, the front door, the trigger and the
-- backfill. Four copies of "count the responders" is four chances to disagree
-- about whether a helper who left still counts.
create or replace function public.sos_active_responders(p_sos text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from sos_responders
  where sos_id = p_sos and left_at is null;
$$;

grant execute on function public.sos_active_responders(text) to authenticated;

create or replace function public.sos_free_slots(p_sos text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select greatest(0, public.sos_wave_size() - public.sos_active_responders(p_sos));
$$;

grant execute on function public.sos_free_slots(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE BOUNDARY: A TRIGGER, NOT ONLY AN RPC
-- ---------------------------------------------------------------------------
-- services/community.ts respondToAlert inserts straight into sos_responders,
-- and the RLS policy from sql/31 permits it. An RPC-only cap would be a cap the
-- shipping app walks around. sql/86 taught this lesson on circle invites; the
-- same shape applies here.
create or replace function public.enforce_sos_responder_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  cap  int := public.sos_wave_size();
  live int;
begin
  if new.left_at is not null then
    return new;                       -- inserting an already-closed row
  end if;

  -- Serialise concurrent accepts on the incident. Without this, three helpers
  -- tapping at the same instant each count 2, each pass, and six arrive.
  perform 1 from sos_events where id::text = new.sos_id for update;

  select count(*) into live
  from sos_responders
  where sos_id = new.sos_id and left_at is null and id <> new.id;

  if live >= cap then
    raise exception
      'Enough helpers are already on the way. % people have accepted.', live
      using errcode = '23514';
  end if;

  if new.wave is null then
    new.wave := coalesce(
      (select e.wave from sos_escalation e where e.sos_id = new.sos_id), 1);
  end if;

  return new;
end $$;

drop trigger if exists trg_sos_responder_cap on sos_responders;
create trigger trg_sos_responder_cap
  before insert on sos_responders
  for each row execute function public.enforce_sos_responder_cap();

-- ---------------------------------------------------------------------------
-- 4. THE FRONT DOOR
-- ---------------------------------------------------------------------------
-- Returns jsonb rather than raising, so a helper who arrives one second late
-- reads a sentence instead of a Postgres error. Being turned away is a normal
-- outcome here, not a fault.
create or replace function public.accept_sos_dispatch(p_sos text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  cap    int  := public.sos_wave_size();
  ev     record;
  live   int;
  mine   boolean;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  -- Lock the incident for the duration. Every count below is taken under it.
  select e.id, e.user_id, e.status into ev
  from sos_events e where e.id::text = p_sos for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found',
      'message', 'That emergency could not be found.');
  end if;

  if ev.status <> 'active' then
    return jsonb_build_object('ok', false, 'reason', 'sos_closed',
      'message', 'This emergency has already been closed. Thank you for going.');
  end if;

  if ev.user_id = uid then
    return jsonb_build_object('ok', false, 'reason', 'own_sos',
      'message', 'This is your own emergency.');
  end if;

  -- Idempotent: tapping Accept twice, or the app retrying after a dropped
  -- response, must not read as a second helper or as a failure.
  select true into mine from sos_responders
   where sos_id = p_sos and user_id = uid and left_at is null;

  if mine then
    return jsonb_build_object('ok', true, 'reason', 'already_accepted',
      'active', public.sos_active_responders(p_sos), 'cap', cap,
      'message', 'You are already on your way.');
  end if;

  live := public.sos_active_responders(p_sos);

  if live >= cap then
    return jsonb_build_object('ok', false, 'reason', 'wave_full',
      'active', live, 'cap', cap,
      'message', format(
        '%s helpers are already on their way. You will be asked again if one of them drops out.',
        live));
  end if;

  insert into sos_responders (sos_id, user_id, name, photo_url, wave)
  select p_sos, uid, u.name, u.photo_url,
         coalesce((select x.wave from sos_escalation x where x.sos_id = p_sos), 1)
  from users_public u where u.id = uid;

  return jsonb_build_object('ok', true, 'reason', 'accepted',
    'active', live + 1, 'cap', cap,
    'message', format('You are helper %s of %s.', live + 1, cap));
end $$;

revoke all on function public.accept_sos_dispatch(text) from public, anon;
grant execute on function public.accept_sos_dispatch(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. DROPPING OUT, AND THE BACKFILL IT TRIGGERS
-- ---------------------------------------------------------------------------
-- A helper who cannot make it must be able to say so, and saying so has to cost
-- nothing socially, or nobody will and the slot stays dead. The victim is never
-- told who left; she is told how many are coming.
alter table sos_escalation
  add column if not exists backfill_requested_at timestamptz;

create or replace function public.drop_sos_dispatch(
  p_sos    text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  live int;
  hit  int;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;

  perform 1 from sos_events where id::text = p_sos for update;

  update sos_responders
     set left_at = now(),
         left_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where sos_id = p_sos and user_id = uid and left_at is null;

  get diagnostics hit = row_count;

  if hit = 0 then
    return jsonb_build_object('ok', true, 'reason', 'not_responding',
      'message', 'You were not listed as coming.');
  end if;

  live := public.sos_active_responders(p_sos);

  -- Ask for a backfill only while the emergency is still open. Flagging a
  -- closed SOS would page strangers toward something that already ended.
  if live < public.sos_wave_size()
     and exists (select 1 from sos_events e
                 where e.id::text = p_sos and e.status = 'active') then
    insert into sos_escalation (sos_id, backfill_requested_at, updated_at)
      values (p_sos, now(), now())
    on conflict (sos_id) do update
      set backfill_requested_at = now(), updated_at = now();
  end if;

  return jsonb_build_object('ok', true, 'reason', 'left',
    'active', live, 'cap', public.sos_wave_size());
end $$;

revoke all on function public.drop_sos_dispatch(text, text) from public, anon;
grant execute on function public.drop_sos_dispatch(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. CLAMP THE INVITE TO THE OPENINGS
-- ---------------------------------------------------------------------------
-- escalate-sos/index.ts passes p_limit: 3 as a literal. Rather than edit the
-- edge function and rely on it staying correct, the clamp lives here, where
-- every caller inherits it. Paging three people for one free slot means two of
-- them drive toward an emergency and get told they are not needed, which is how
-- you teach helpers to stop opening the notification.
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
    -- Anyone who has ever been on this SOS is excluded, including someone who
    -- accepted and left. Re-inviting a person who just said they could not come
    -- is noise to them and a false hope on the victim's screen.
    and not exists (select 1 from sos_responders r
                    where r.sos_id = p_sos and r.user_id = hl.user_id)
    and st_dwithin(hl.location, st_point(p_lng, p_lat)::geography, 3000)
  order by distance_m
  limit greatest(0, least(coalesce(p_limit, public.sos_wave_size()),
                          public.sos_free_slots(p_sos)));
$$;

-- ---------------------------------------------------------------------------
-- 7. THE TICK LEARNS ABOUT BACKFILLS
-- ---------------------------------------------------------------------------
-- Emitted as action 'dispatch_wave', which escalate-sos already handles, so the
-- edge function needs no change. The wave number does NOT advance: a backfill
-- refills the wave that is running, it is not an escalation, and counting it as
-- one would burn through sos_max_waves() for people who never left.
create or replace function public.sos_escalation_tick()
returns table (
  sos_id text,
  victim_id uuid,
  lat double precision,
  lng double precision,
  wave int,
  action text
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
      and ev.kind = 'real'
      and ev.created_at > now() - interval '2 hours'
  loop
    select * into esc from sos_escalation where sos_escalation.sos_id = e.sid;
    if not found then
      insert into sos_escalation (sos_id) values (e.sid);
      select * into esc from sos_escalation where sos_escalation.sos_id = e.sid;
    end if;

    if esc.victim_safe is true then continue; end if;

    -- BACKFILL, checked before the max-waves ceiling. That ceiling exists to
    -- stop an abandoned SOS paging a whole city all night. Replacing a helper
    -- who dropped out is not that: the number of people converging on her is
    -- going back up to three, never past it.
    if esc.backfill_requested_at is not null
       and public.sos_free_slots(e.sid) > 0 then
      update sos_escalation
         set backfill_requested_at = null, last_wave_at = now(), updated_at = now()
       where sos_escalation.sos_id = e.sid;
      sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
      wave := esc.wave; action := 'dispatch_wave';
      return next;
      continue;
    end if;

    -- A stale request: somebody left and somebody else has already filled the
    -- slot. Clear it so it does not fire later against a full wave.
    if esc.backfill_requested_at is not null then
      update sos_escalation set backfill_requested_at = null, updated_at = now()
       where sos_escalation.sos_id = e.sid;
    end if;

    if esc.wave >= public.sos_max_waves() then continue; end if;

    select count(*) into n_arrived
      from sos_arrival_codes c
      where c.sos_id::text = e.sid and c.entered_at is not null;
    select count(*) into n_responders
      from sos_responders r where r.sos_id = e.sid and r.left_at is null;

    if n_arrived = 0 then
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

    if esc.first_arrival_at is null then
      update sos_escalation set first_arrival_at = now(), updated_at = now()
        where sos_escalation.sos_id = e.sid;
      continue;
    end if;

    if esc.victim_pinged_at is null
       and esc.first_arrival_at < now() - make_interval(secs => public.sos_arrival_grace()) then
      update sos_escalation set victim_pinged_at = now(), stalled = true, updated_at = now()
        where sos_escalation.sos_id = e.sid;
      sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
      wave := esc.wave; action := 'ping_victim';
      return next;
      continue;
    end if;

    if esc.victim_pinged_at is not null
       and esc.victim_answered_at is null
       and esc.victim_pinged_at < now() - make_interval(secs => public.sos_ping_window()) then
      update sos_escalation
        set wave = esc.wave + 1, last_wave_at = now(),
            victim_pinged_at = null,
            updated_at = now()
        where sos_escalation.sos_id = e.sid;
      sos_id := e.sid; victim_id := e.user_id; lat := e.lat; lng := e.lng;
      wave := esc.wave + 1; action := 'dispatch_wave';
      return next;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text; over int;
begin
  select string_agg(n || ': ' || v, chr(10)) into msg from (
    select 'sos_responders.left_at' as n,
           case when exists (select 1 from information_schema.columns
                             where table_name='sos_responders' and column_name='left_at')
                then 'ok' else 'MISSING' end as v
    union all
    select 'live responder unique index',
           case when exists (select 1 from pg_indexes where indexname='sos_responders_live_uq')
                then 'ok' else 'MISSING' end
    union all
    select 'cap trigger',
           case when exists (select 1 from pg_trigger where tgname='trg_sos_responder_cap')
                then 'ok' else 'MISSING' end
    union all
    select 'accept rpc',
           case when to_regprocedure('public.accept_sos_dispatch(text)') is not null
                then 'ok' else 'MISSING' end
    union all
    select 'drop rpc',
           case when to_regprocedure('public.drop_sos_dispatch(text,text)') is not null
                then 'ok' else 'MISSING' end
    union all
    select 'backfill column',
           case when exists (select 1 from information_schema.columns
                             where table_name='sos_escalation' and column_name='backfill_requested_at')
                then 'ok' else 'MISSING' end
    union all
    select 'cap value (from sos_wave_size)', public.sos_wave_size()::text
  ) c;
  raise notice '%', msg;

  select count(*) into over from (
    select sos_id from sos_responders where left_at is null
    group by sos_id having count(*) > public.sos_wave_size()
  ) x;
  raise notice 'SOS events already over the cap: % (left untouched)', over;
end $$;
