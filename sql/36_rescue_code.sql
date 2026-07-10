-- ORBII — rescue completion code. Paste into Supabase SQL Editor. Idempotent.
--
-- A 4-digit code is generated for each SOS. The VICTIM sees it on her screen.
-- When the helper physically reaches her, he asks for it and types it in. Only
-- a correct code completes the rescue.
--
-- WHY IT'S A SEPARATE TABLE: `sos_events` has a "read active SOS" policy so
-- nearby helpers can see the alert. If the code lived on that row, every helper
-- in a 2 km radius could read it and "complete" a rescue from their sofa. Here
-- the code is readable ONLY by the victim, and the helper never reads it at
-- all — he submits a guess to a SECURITY DEFINER function that compares it.
--
-- This is the same trick Uber/Zomato use, and it's the strongest arrival proof
-- we have: geofencing says the phone was nearby, the code says a human actually
-- spoke to her.

create table if not exists sos_verify_codes (
  sos_id     text primary key references sos_events(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  code       text not null check (code ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now()
);

alter table sos_verify_codes enable row level security;

-- ONLY the victim can read her own code. No insert/update/delete policy exists,
-- so the code can only ever be created by the SECURITY DEFINER function below.
drop policy if exists "verify code read own" on sos_verify_codes;
create policy "verify code read own"
  on sos_verify_codes for select
  to authenticated
  using (auth.uid() = user_id);

-- Track completion on the rescue itself.
alter table rescue_events
  add column if not exists code_verified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Victim: fetch (creating on first call) the code for her SOS.
-- ---------------------------------------------------------------------------
create or replace function ensure_sos_code(p_sos text)
returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); existing text; owner uuid;
begin
  if uid is null then raise exception 'auth required'; end if;
  -- Only the SOS owner may mint or read the code.
  select user_id into owner from sos_events where id = p_sos;
  if owner is null or owner <> uid then raise exception 'not your SOS'; end if;

  select code into existing from sos_verify_codes where sos_id = p_sos;
  if existing is not null then return existing; end if;

  -- 4 digits, uniformly random, leading zeros preserved.
  existing := lpad((floor(random() * 10000))::int::text, 4, '0');
  insert into sos_verify_codes (sos_id, user_id, code)
    values (p_sos, uid, existing)
    on conflict (sos_id) do nothing;
  -- Re-read in case of a concurrent insert.
  select code into existing from sos_verify_codes where sos_id = p_sos;
  return existing;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: submit the code the victim read out. Never reads it back.
-- ---------------------------------------------------------------------------
-- Returns true on success. A wrong code returns false and changes nothing, so
-- the helper can retry (he may have misheard) without any state to clean up.
create or replace function verify_rescue_code(p_event uuid, p_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare ev rescue_events%rowtype; expected text;
begin
  select * into ev from rescue_events where id = p_event and helper_id = auth.uid();
  if ev.id is null then raise exception 'not your rescue'; end if;
  if ev.code_verified_at is not null then return true; end if; -- idempotent

  select code into expected from sos_verify_codes where sos_id = ev.sos_id;
  if expected is null or expected <> p_code then
    -- Wrong guess is itself a signal: someone typing codes they weren't given.
    insert into fraud_signals (rescue_event_id, code, weight, detail)
      values (p_event, 'bad_rescue_code', 15, jsonb_build_object('at', now()));
    return false;
  end if;

  -- Correct. The victim physically handed him the code: that is a real, human
  -- confirmation of arrival — far stronger than a self-declared "I've reached".
  update rescue_events set
    code_verified_at = now(),
    victim_confirmed = true,
    arrived_at = coalesce(arrived_at, now()),
    arrival_rank = coalesce(
      arrival_rank,
      (select count(*) + 1 from rescue_events e2
        where e2.sos_id = ev.sos_id and e2.arrived_at is not null)
    )
  where id = p_event;

  return true;
end $$;

revoke all on function ensure_sos_code(text) from public, anon;
revoke all on function verify_rescue_code(uuid, text) from public, anon;
grant execute on function ensure_sos_code(text) to authenticated;
grant execute on function verify_rescue_code(uuid, text) to authenticated;
