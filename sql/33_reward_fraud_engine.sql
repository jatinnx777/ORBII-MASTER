-- ORBII — Verified Helper reward + fraud-prevention engine (server-authoritative).
--
-- WHY THIS IS ALL SERVER-SIDE: a reward amount computed on the phone can be
-- forged in seconds. Everything that decides money — eligibility, the fraud
-- score, the reward formula, daily limits, the payout hold — runs here as
-- SECURITY DEFINER functions the client cannot bypass. The app only REPORTS
-- signals (geofence arrival, movement, timings, device/wifi fingerprints) and
-- READS results. Raw contact numbers are never stored: they are hashed with a
-- server-only pepper the moment they arrive and only the hash is kept.
--
-- Idempotent — safe to paste into the Supabase SQL editor and re-run.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 0. SECRETS + TUNABLE CONFIG (nothing hardcoded in app code)
-- ---------------------------------------------------------------------------
create table if not exists reward_secrets (
  key text primary key,
  value text not null
);
alter table reward_secrets enable row level security;  -- no policies => clients can't read
insert into reward_secrets (key, value)
  values ('phone_pepper', encode(gen_random_bytes(32), 'hex'))
  on conflict (key) do nothing;

create table if not exists reward_config (
  id boolean primary key default true check (id),   -- single row
  base_paise            int not null default 5000,   -- ₹50
  distance_cap_km       numeric not null default 8,
  distance_max_paise    int not null default 5000,   -- ₹50 at the cap
  reward_cap_paise      int not null default 40000,  -- ₹400 hard cap
  fraud_threshold       int not null default 70,     -- > this => hold for review
  scene_min_seconds     int not null default 120,    -- < 2 min on scene => no reward
  max_paid_per_sos      int not null default 3,      -- only first 3 arrivals paid
  daily_limit           int not null default 2,
  weekly_limit          int not null default 10,
  monthly_limit         int not null default 25
);
insert into reward_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 1. PRIVACY-SAFE PHONE HASHING
-- ---------------------------------------------------------------------------
-- Normalise to the last 10 digits so +91, spaces and 0-prefixes all match.
create or replace function normalize_phone(p text)
returns text language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10);
$$;

-- Salted SHA-256 with the server-only pepper. SECURITY DEFINER so the pepper
-- never leaves the database.
create or replace function hash_phone(p text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare pepper text; n text;
begin
  n := normalize_phone(p);
  if length(n) < 10 then return null; end if;
  select value into pepper from reward_secrets where key = 'phone_pepper';
  return encode(digest(pepper || ':' || n, 'sha256'), 'hex');
end;
$$;

-- Victim's hashed contacts. The app sends RAW numbers to store_contact_hashes;
-- they are hashed here and only the hash is persisted — raw digits are never
-- written to a table.
create table if not exists victim_contact_hashes (
  user_id uuid not null references auth.users(id) on delete cascade,
  phone_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, phone_hash)
);
alter table victim_contact_hashes enable row level security;
drop policy if exists "own contact hashes" on victim_contact_hashes;
create policy "own contact hashes" on victim_contact_hashes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function store_contact_hashes(phones text[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare uid uuid := auth.uid(); ph text; h text; c int := 0;
begin
  if uid is null then return 0; end if;
  foreach ph in array phones loop
    h := hash_phone(ph);
    if h is not null then
      insert into victim_contact_hashes (user_id, phone_hash)
        values (uid, h) on conflict do nothing;
      c := c + 1;
    end if;
  end loop;
  return c;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. RESCUE EVENTS — the movement-verified record of one helper responding
-- ---------------------------------------------------------------------------
create table if not exists rescue_events (
  id uuid primary key default gen_random_uuid(),
  sos_id uuid not null,
  helper_id uuid not null references auth.users(id) on delete cascade,
  victim_id uuid not null references auth.users(id) on delete cascade,
  accepted_at   timestamptz not null default now(),
  first_moved_at timestamptz,
  arrived_at    timestamptz,          -- set ONLY by geofence, never a manual tap
  departed_at   timestamptz,
  accept_latency_sec int,             -- from SOS creation to accept
  road_meters   int not null default 0,   -- snapped road distance travelled
  on_scene_sec  int not null default 0,
  arrival_rank  int,                  -- 1st/2nd/3rd… arrival for this SOS
  victim_rating int,                  -- 1..5, set by the victim
  victim_confirmed boolean,
  device_id     text,
  wifi_hash     text,
  mock_location boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (sos_id, helper_id)
);
alter table rescue_events enable row level security;
create index if not exists rescue_events_sos_idx on rescue_events (sos_id);
create index if not exists rescue_events_helper_idx on rescue_events (helper_id);

drop policy if exists "rescue read own side" on rescue_events;
create policy "rescue read own side" on rescue_events
  for select using (auth.uid() = helper_id or auth.uid() = victim_id);

-- ---------------------------------------------------------------------------
-- 3. FRAUD SIGNALS + REWARDS
-- ---------------------------------------------------------------------------
create table if not exists fraud_signals (
  id bigint generated always as identity primary key,
  rescue_event_id uuid not null references rescue_events(id) on delete cascade,
  code text not null,
  weight int not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table fraud_signals enable row level security;
create index if not exists fraud_signals_event_idx on fraud_signals (rescue_event_id);

create table if not exists rescue_rewards (
  id uuid primary key default gen_random_uuid(),
  rescue_event_id uuid not null unique references rescue_events(id) on delete cascade,
  helper_id uuid not null references auth.users(id) on delete cascade,
  sos_id uuid not null,
  base_paise int not null default 0,
  distance_bonus_paise int not null default 0,
  response_bonus_paise int not null default 0,
  scene_bonus_paise int not null default 0,
  rating_bonus_paise int not null default 0,
  trust_multiplier numeric not null default 1.0,
  amount_paise int not null default 0,
  fraud_score int not null default 0,
  eligible boolean not null default false,
  status text not null default 'pending_review'
    check (status in ('pending_review','manual_review','approved','rejected','paid')),
  reason text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table rescue_rewards enable row level security;
create index if not exists rescue_rewards_helper_idx on rescue_rewards (helper_id, created_at desc);
create index if not exists rescue_rewards_status_idx on rescue_rewards (status);

drop policy if exists "rewards read own" on rescue_rewards;
create policy "rewards read own" on rescue_rewards
  for select using (auth.uid() = helper_id);

-- ---------------------------------------------------------------------------
-- 4. TRUST MULTIPLIER (mirrors guardianLevel in the app)
-- ---------------------------------------------------------------------------
create or replace function trust_multiplier(p_helper uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare n int; t int;
begin
  select coalesce(lifetime_responses,0), coalesce(trust_score,0)
    into n, t from helper_profiles where user_id = p_helper;
  if n is null then return 1.0; end if;
  if n >= 150 and t >= 90 then return 1.5;   -- Elite Guardian
  elsif n >= 80 and t >= 82 then return 1.35; -- Guardian
  elsif n >= 50 and t >= 75 then return 1.2;  -- Gold
  elsif n >= 15 and t >= 60 then return 1.1;  -- Silver
  else return 1.0;                            -- Bronze
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. ELIGIBILITY — who may NEVER be paid (recognition only)
-- ---------------------------------------------------------------------------
create or replace function is_reward_eligible(p_event uuid)
returns table(eligible boolean, reason text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_victim uuid; v_helper uuid; v_hphone text; v_hash text; v_verified boolean;
begin
  select victim_id, helper_id into v_victim, v_helper
    from rescue_events where id = p_event;
  if v_victim is null then return query select false, 'no_event'; return; end if;

  if v_victim = v_helper then
    return query select false, 'self'; return;
  end if;

  -- Only verified responders are ever paid.
  select (verification_status = 'verified') into v_verified
    from helper_profiles where user_id = v_helper;
  if coalesce(v_verified, false) = false then
    return query select false, 'not_verified'; return;
  end if;

  -- Helper's phone hashed once for the contact checks.
  select phone into v_hphone from profiles where id = v_helper;
  v_hash := hash_phone(v_hphone);

  -- (a) helper is an emergency contact of the victim (by hashed phone)
  if v_hash is not null and exists (
    select 1 from emergency_contacts ec
    where ec.user_id = v_victim and hash_phone(ec.phone) = v_hash
  ) then
    return query select false, 'emergency_contact'; return;
  end if;

  -- (b) helper's number is anywhere in the victim's uploaded contacts
  if v_hash is not null and exists (
    select 1 from victim_contact_hashes vch
    where vch.user_id = v_victim and vch.phone_hash = v_hash
  ) then
    return query select false, 'mutual_contact'; return;
  end if;

  -- (c) helper shares a circle with the victim (trusted circle / family)
  if exists (
    select 1 from circle_members a
    join circle_members b on a.circle_id = b.circle_id
    where a.user_id = v_victim and b.user_id = v_helper
  ) then
    return query select false, 'trusted_circle'; return;
  end if;

  return query select true, 'eligible';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. FRAUD SCORE — server-known signals + client-reported signals, capped 100
-- ---------------------------------------------------------------------------
create or replace function compute_fraud_score(p_event uuid)
returns int
language plpgsql stable security definer set search_path = public as $$
declare
  ev rescue_events%rowtype; score int := 0; cfg reward_config%rowtype;
  pair_count int; recent_count int;
begin
  select * into ev from rescue_events where id = p_event;
  if ev.id is null then return 100; end if;
  select * into cfg from reward_config where id;

  -- client-reported signals (spoofing, impossible speed, teleport, same wifi…)
  select coalesce(sum(weight),0) into score from fraud_signals where rescue_event_id = p_event;

  -- server-known signals -----------------------------------------------------
  if ev.mock_location then score := score + 80; end if;                 -- GPS spoofing
  if ev.arrived_at is null then score := score + 80; end if;            -- no geofence arrival
  if ev.first_moved_at is null then score := score + 60; end if;        -- never moved
  if ev.victim_confirmed is false then score := score + 50; end if;     -- victim declined
  if ev.road_meters < 40 then score := score + 40; end if;              -- no real travel

  -- repeated victim↔helper pair recently
  select count(*) into pair_count from rescue_rewards r
    join rescue_events e on e.id = r.rescue_event_id
    where e.victim_id = ev.victim_id and r.helper_id = ev.helper_id
      and r.created_at > now() - interval '30 days';
  if pair_count >= 2 then score := score + 40; end if;

  -- reward farming: too many rescues by this helper in a short window
  select count(*) into recent_count from rescue_events
    where helper_id = ev.helper_id and created_at > now() - interval '2 hours';
  if recent_count >= 4 then score := score + 40; end if;

  -- shared device fingerprint between victim and helper (same phone)
  if ev.device_id is not null and exists (
    select 1 from rescue_events e2
    where e2.helper_id = ev.victim_id and e2.device_id = ev.device_id
  ) then score := score + 100; end if;

  return least(100, score);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. REWARD FORMULA + FINALISE (called when the helper departs the scene)
-- ---------------------------------------------------------------------------
-- reward = (base + distance + response + scene + rating) × trust, capped.
create or replace function finalize_rescue_reward(p_event uuid)
returns rescue_rewards
language plpgsql security definer set search_path = public as $$
declare
  ev rescue_events%rowtype; cfg reward_config%rowtype;
  elig boolean; why text; fscore int; mult numeric;
  base int := 0; dist int := 0; resp int := 0; scene int := 0; rate int := 0;
  total int := 0; st text; day_n int; week_n int; month_n int; paid_n int;
  out_row rescue_rewards;
begin
  select * into ev from rescue_events where id = p_event;
  if ev.id is null then raise exception 'no such rescue event'; end if;
  select * into cfg from reward_config where id;

  select e.eligible, e.reason into elig, why from is_reward_eligible(p_event) e;
  fscore := compute_fraud_score(p_event);
  mult := trust_multiplier(ev.helper_id);

  if elig and ev.on_scene_sec >= cfg.scene_min_seconds
     and ev.arrival_rank is not null and ev.arrival_rank <= cfg.max_paid_per_sos then
    -- base
    base := cfg.base_paise;
    -- distance bonus (road, capped at distance_cap_km)
    dist := least(cfg.distance_max_paise,
      round(cfg.distance_max_paise * least(ev.road_meters::numeric / 1000.0, cfg.distance_cap_km) / cfg.distance_cap_km));
    -- fast-response bonus
    resp := case
      when ev.accept_latency_sec is null then 0
      when ev.accept_latency_sec <= 30 then 1000
      when ev.accept_latency_sec <= 120 then 500
      when ev.accept_latency_sec <= 600 then 0
      else 0 end;
    -- time-on-scene bonus (must have stayed; longer presence rewarded once)
    scene := case
      when ev.on_scene_sec < cfg.scene_min_seconds then 0
      when ev.on_scene_sec < 600 then 1000
      else 500 end;
    -- victim rating bonus
    rate := case
      when ev.victim_rating = 5 then 500
      when ev.victim_rating = 4 then 300
      else 0 end;
    total := round((base + dist + resp + scene + rate) * mult);
    total := least(total, cfg.reward_cap_paise);
  end if;

  -- daily / weekly / monthly paid caps (count already-approved/paid rewards)
  select count(*) into day_n from rescue_rewards
    where helper_id = ev.helper_id and status in ('approved','paid')
      and created_at::date = now()::date;
  select count(*) into week_n from rescue_rewards
    where helper_id = ev.helper_id and status in ('approved','paid')
      and created_at > date_trunc('week', now());
  select count(*) into month_n from rescue_rewards
    where helper_id = ev.helper_id and status in ('approved','paid')
      and created_at > date_trunc('month', now());

  -- decide status. Payments are NEVER instant: clean ones wait for the weekly
  -- batch (pending_review); risky ones go to manual_review; ineligible get 0.
  if not elig or total = 0 then
    st := 'rejected';
  elsif fscore > cfg.fraud_threshold then
    st := 'manual_review';
  elsif day_n >= cfg.daily_limit or week_n >= cfg.weekly_limit or month_n >= cfg.monthly_limit then
    st := 'manual_review'; why := 'over_limit';
  else
    st := 'pending_review';
  end if;

  insert into rescue_rewards (
    rescue_event_id, helper_id, sos_id, base_paise, distance_bonus_paise,
    response_bonus_paise, scene_bonus_paise, rating_bonus_paise, trust_multiplier,
    amount_paise, fraud_score, eligible, status, reason
  ) values (
    p_event, ev.helper_id, ev.sos_id, base, dist, resp, scene, rate, mult,
    case when st = 'rejected' then 0 else total end, fscore, elig, st, why
  )
  on conflict (rescue_event_id) do update set
    amount_paise = excluded.amount_paise, fraud_score = excluded.fraud_score,
    eligible = excluded.eligible, status = excluded.status, reason = excluded.reason,
    base_paise = excluded.base_paise, distance_bonus_paise = excluded.distance_bonus_paise,
    response_bonus_paise = excluded.response_bonus_paise, scene_bonus_paise = excluded.scene_bonus_paise,
    rating_bonus_paise = excluded.rating_bonus_paise, trust_multiplier = excluded.trust_multiplier
  returning * into out_row;

  return out_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. CLIENT-FACING RPCs (thin, validated)
-- ---------------------------------------------------------------------------
-- Helper accepts an SOS → open a rescue event. accept latency uses sos age.
create or replace function rescue_accept(p_sos uuid, p_victim uuid, p_sos_created timestamptz, p_device text, p_mock boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); id uuid;
begin
  if uid is null then raise exception 'auth required'; end if;
  insert into rescue_events (sos_id, helper_id, victim_id, accept_latency_sec, device_id, mock_location)
    values (p_sos, uid, p_victim, greatest(0, extract(epoch from (now() - coalesce(p_sos_created, now())))::int), p_device, coalesce(p_mock,false))
  on conflict (sos_id, helper_id) do update set device_id = excluded.device_id
  returning id into id;
  return id;
end;
$$;

-- Movement report (snapped road metres so far; sets first_moved once).
create or replace function rescue_report_movement(p_event uuid, p_road_meters int, p_mock boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update rescue_events set
    road_meters = greatest(road_meters, coalesce(p_road_meters,0)),
    first_moved_at = coalesce(first_moved_at, case when p_road_meters > 15 then now() end),
    mock_location = mock_location or coalesce(p_mock,false)
  where id = p_event and helper_id = auth.uid();
end;
$$;

-- Geofence arrival (auto — never a manual tap). Ranks arrivals per SOS.
create or replace function rescue_geofence_arrival(p_event uuid)
returns int language plpgsql security definer set search_path = public as $$
declare ev rescue_events%rowtype; rank int;
begin
  select * into ev from rescue_events where id = p_event and helper_id = auth.uid();
  if ev.id is null or ev.arrived_at is not null then return ev.arrival_rank; end if;
  select count(*) + 1 into rank from rescue_events
    where sos_id = ev.sos_id and arrived_at is not null;
  update rescue_events set arrived_at = now(), arrival_rank = rank where id = p_event;
  return rank;
end;
$$;

-- Departure from the geofence → compute on-scene time + finalise the reward.
create or replace function rescue_depart(p_event uuid)
returns rescue_rewards language plpgsql security definer set search_path = public as $$
declare ev rescue_events%rowtype;
begin
  select * into ev from rescue_events where id = p_event and helper_id = auth.uid();
  if ev.id is null then raise exception 'no event'; end if;
  update rescue_events set
    departed_at = now(),
    on_scene_sec = case when arrived_at is not null
      then greatest(0, extract(epoch from (now() - arrived_at))::int) else 0 end
  where id = p_event;
  return finalize_rescue_reward(p_event);
end;
$$;

-- Report a client-side fraud signal (impossible speed, teleport, same wifi…).
create or replace function rescue_report_signal(p_event uuid, p_code text, p_weight int, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rescue_events where id = p_event and helper_id = auth.uid()) then return; end if;
  insert into fraud_signals (rescue_event_id, code, weight, detail)
    values (p_event, p_code, least(100, greatest(0, coalesce(p_weight,0))), coalesce(p_detail,'{}'::jsonb));
end;
$$;

-- Victim rates / confirms their helper.
create or replace function rescue_rate(p_event uuid, p_stars int, p_confirmed boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  update rescue_events set
    victim_rating = greatest(1, least(5, coalesce(p_stars, victim_rating))),
    victim_confirmed = coalesce(p_confirmed, victim_confirmed)
  where id = p_event and victim_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. WEEKLY PAYOUT BATCH (admin only — payments are never instant)
-- ---------------------------------------------------------------------------
-- Approves clean pending rewards inside the caps and credits the helper ledger
-- via the existing admin_credit_earning. Run weekly after fraud review.
create or replace function process_weekly_payouts()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; cfg reward_config%rowtype; day_n int; week_n int; month_n int;
begin
  select * into cfg from reward_config where id;
  -- Oldest first so the caps fill in chronological order as we mark rows paid.
  for r in
    select rr.* from rescue_rewards rr
    where rr.status = 'pending_review' and rr.amount_paise > 0
    order by rr.created_at asc
  loop
    -- Re-check fraud at payout time; anything risky goes to manual review.
    if r.fraud_score > cfg.fraud_threshold then
      update rescue_rewards set status = 'manual_review', reason = 'fraud', decided_at = now() where id = r.id;
      continue;
    end if;
    -- Enforce the paid caps against ALREADY-PAID rewards in the same
    -- day/week/month as THIS reward (the batch pays retroactively).
    select count(*) into day_n from rescue_rewards
      where helper_id = r.helper_id and status = 'paid' and created_at::date = r.created_at::date;
    select count(*) into week_n from rescue_rewards
      where helper_id = r.helper_id and status = 'paid'
        and date_trunc('week', created_at) = date_trunc('week', r.created_at);
    select count(*) into month_n from rescue_rewards
      where helper_id = r.helper_id and status = 'paid'
        and date_trunc('month', created_at) = date_trunc('month', r.created_at);
    if day_n >= cfg.daily_limit or week_n >= cfg.weekly_limit or month_n >= cfg.monthly_limit then
      update rescue_rewards set status = 'manual_review', reason = 'over_limit', decided_at = now() where id = r.id;
      continue;
    end if;
    perform admin_credit_earning(r.helper_id, r.amount_paise, 'Rescue reward');
    update rescue_rewards set status = 'paid', decided_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. GRANTS — clients may call the thin RPCs; the batch is admin-only.
-- ---------------------------------------------------------------------------
revoke all on function process_weekly_payouts() from public, anon, authenticated;
revoke all on function finalize_rescue_reward(uuid) from public, anon;   -- called only via rescue_depart
revoke all on function hash_phone(text) from public, anon, authenticated;
grant execute on function store_contact_hashes(text[]) to authenticated;
grant execute on function rescue_accept(uuid,uuid,timestamptz,text,boolean) to authenticated;
grant execute on function rescue_report_movement(uuid,int,boolean) to authenticated;
grant execute on function rescue_geofence_arrival(uuid) to authenticated;
grant execute on function rescue_depart(uuid) to authenticated;
grant execute on function rescue_report_signal(uuid,text,int,jsonb) to authenticated;
grant execute on function rescue_rate(uuid,int,boolean) to authenticated;
