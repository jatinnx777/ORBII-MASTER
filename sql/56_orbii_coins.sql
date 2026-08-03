-- 56_orbii_coins.sql
-- ============================================================================
-- ORBII coins: how verified helpers are paid, without handing cash to a
-- stranger on the street.
--
-- Rules (set by founder + E-Cell head, Aug 2026):
--   * 10 coins = ₹1.
--   * A verified helper earns 200 coins (₹20) per CONFIRMED help. "Confirmed"
--     means the victim's arrival code was entered (sql/51), so coins can never
--     be farmed without a real, in-person arrival.
--   * A helper can only request a redemption once their vault holds 500+ coins
--     (₹50 minimum).
--
-- Also: verified-helper dispatch is now FREE for everyone, capped at 2 per month
-- on the free plan (Plus is unlimited). This file adds the monthly counter that
-- the notify-sos function checks.
--
-- Run once in Supabase.
-- ============================================================================

-- 1. The vault: one running balance per helper. ----------------------------
create table if not exists helper_coins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  balance    bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

alter table helper_coins enable row level security;
drop policy if exists helper_coins_own on helper_coins;
create policy helper_coins_own on helper_coins
  for select to authenticated using (user_id = auth.uid());

-- 2. Every coin movement, for an auditable history. ------------------------
create table if not exists coin_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      bigint not null,             -- +earned / -redeemed
  reason     text not null,               -- 'help_confirmed' | 'redemption' | ...
  sos_id     uuid references sos_events(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coin_tx_user_idx on coin_transactions (user_id, created_at desc);

alter table coin_transactions enable row level security;
drop policy if exists coin_tx_own on coin_transactions;
create policy coin_tx_own on coin_transactions
  for select to authenticated using (user_id = auth.uid());

-- 3. Redemption requests (the actual payout is settled off-platform). -------
create table if not exists coin_redemptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  coins      bigint not null check (coins >= 500),
  rupees     numeric(10,2) not null,      -- coins / 10
  status     text not null default 'requested'
               check (status in ('requested', 'paid', 'rejected')),
  created_at timestamptz not null default now()
);
create index if not exists coin_redemptions_user_idx on coin_redemptions (user_id, created_at desc);

alter table coin_redemptions enable row level security;
drop policy if exists coin_redemptions_own on coin_redemptions;
create policy coin_redemptions_own on coin_redemptions
  for select to authenticated using (user_id = auth.uid());

-- 4. Internal award helper: credit coins + log the transaction. -------------
-- SECURITY DEFINER, called only from other trusted functions (never the client).
create or replace function public.award_helper_coins(
  p_uid uuid, p_amount bigint, p_reason text, p_sos uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_amount <= 0 then return; end if;
  insert into helper_coins (user_id, balance, updated_at)
    values (p_uid, p_amount, now())
  on conflict (user_id)
    do update set balance = helper_coins.balance + p_amount, updated_at = now();
  insert into coin_transactions (user_id, delta, reason, sos_id)
    values (p_uid, p_amount, p_reason, p_sos);
end $$;

revoke all on function public.award_helper_coins(uuid, bigint, text, uuid) from public, anon, authenticated;

-- 5. Wallet read: balance, whether redeemable, recent transactions. ---------
create or replace function public.get_coin_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_balance bigint;
  v_tx jsonb;
begin
  if uid is null then raise exception 'auth required'; end if;
  select coalesce(balance, 0) into v_balance from helper_coins where user_id = uid;
  v_balance := coalesce(v_balance, 0);
  select coalesce(jsonb_agg(t), '[]'::jsonb) into v_tx from (
    select delta, reason, created_at
    from coin_transactions where user_id = uid
    order by created_at desc limit 30
  ) t;
  return jsonb_build_object(
    'balance', v_balance,
    'rupees', round(v_balance / 10.0, 2),
    'can_redeem', v_balance >= 500,
    'min_redeem', 500,
    'transactions', v_tx
  );
end $$;

grant execute on function public.get_coin_wallet() to authenticated;

-- 6. Request a redemption: only at 500+, cashes out the whole vault. --------
create or replace function public.request_coin_redemption()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_balance bigint;
begin
  if uid is null then raise exception 'auth required'; end if;
  select coalesce(balance, 0) into v_balance from helper_coins where user_id = uid for update;
  v_balance := coalesce(v_balance, 0);
  if v_balance < 500 then
    return jsonb_build_object('ok', false, 'reason', 'below_min', 'balance', v_balance);
  end if;

  insert into coin_redemptions (user_id, coins, rupees)
    values (uid, v_balance, round(v_balance / 10.0, 2));
  update helper_coins set balance = 0, updated_at = now() where user_id = uid;
  insert into coin_transactions (user_id, delta, reason)
    values (uid, -v_balance, 'redemption');

  return jsonb_build_object('ok', true, 'coins', v_balance, 'rupees', round(v_balance / 10.0, 2));
end $$;

grant execute on function public.request_coin_redemption() to authenticated;

-- 7. Free-plan monthly dispatch counter (2 verified helps / month). ---------
create table if not exists helper_dispatch_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  yyyymm  text not null,                  -- e.g. '2026-08'
  count   int  not null default 0,
  primary key (user_id, yyyymm)
);

alter table helper_dispatch_usage enable row level security;
-- No client policy: only the service-role notify-sos function touches this.

-- Called by notify-sos BEFORE dispatching verified helpers. Premium users are
-- always allowed; free users are allowed 2 per calendar month. Returns whether
-- the dispatch may proceed, and consumes one free slot if it does.
create or replace function public.try_consume_free_dispatch(p_uid uuid, p_is_premium boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ym text := to_char(now(), 'YYYY-MM');
  v_count int;
begin
  if p_is_premium then
    return jsonb_build_object('allowed', true, 'unlimited', true);
  end if;
  insert into helper_dispatch_usage (user_id, yyyymm, count)
    values (p_uid, ym, 0)
  on conflict (user_id, yyyymm) do nothing;
  select count into v_count from helper_dispatch_usage where user_id = p_uid and yyyymm = ym for update;
  if coalesce(v_count, 0) >= 2 then
    return jsonb_build_object('allowed', false, 'used', v_count, 'limit', 2);
  end if;
  update helper_dispatch_usage set count = count + 1 where user_id = p_uid and yyyymm = ym;
  return jsonb_build_object('allowed', true, 'used', coalesce(v_count,0) + 1, 'limit', 2);
end $$;

revoke all on function public.try_consume_free_dispatch(uuid, boolean) from public, anon, authenticated;
-- service_role calls it from the edge function.
grant execute on function public.try_consume_free_dispatch(uuid, boolean) to service_role;

-- 8. Read how many free helps I have left this month (for the app UI). -------
create or replace function public.get_free_helps_left()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ym text := to_char(now(), 'YYYY-MM');
  v_count int;
begin
  if uid is null then raise exception 'auth required'; end if;
  select count into v_count from helper_dispatch_usage where user_id = uid and yyyymm = ym;
  return jsonb_build_object('used', coalesce(v_count, 0), 'limit', 2, 'left', greatest(0, 2 - coalesce(v_count, 0)));
end $$;

grant execute on function public.get_free_helps_left() to authenticated;

-- 9. Redefine submit_arrival_code (from sql/51) to AWARD 200 coins when a
-- VERIFIED helper's own code is confirmed. Tying the award to the arrival-code
-- handshake means a helper can't earn coins without a real, in-person arrival.
-- Non-verified (shared-code) helpers are volunteers and earn nothing.
create or replace function public.submit_arrival_code(p_sos uuid, p_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_kind text;
  v_remaining int;
begin
  if uid is null then raise exception 'auth required'; end if;

  -- A verified helper must enter THEIR own code; anyone may enter the shared one.
  select id, kind into v_id, v_kind
  from sos_arrival_codes
  where sos_id = p_sos
    and entered = false
    and code = p_code
    and ((kind = 'verified' and assignee_id = uid) or kind = 'shared')
  limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'wrong', true, 'all_done', false);
  end if;

  update sos_arrival_codes
    set entered = true, entered_name = p_name, entered_at = now()
  where id = v_id;

  -- Mark this helper as arrived + victim-confirmed, mirroring sql/36.
  update rescue_events
    set victim_confirmed = true,
        arrived_at = coalesce(arrived_at, now()),
        arrival_rank = coalesce(
          arrival_rank,
          (select count(*) + 1 from rescue_events e2
            where e2.sos_id = p_sos and e2.arrived_at is not null)
        )
  where sos_id = p_sos and helper_id = uid;

  -- Pay the verified helper in ORBII coins for a confirmed, in-person arrival.
  if v_kind = 'verified' then
    perform public.award_helper_coins(uid, 200, 'help_confirmed', p_sos);
  end if;

  select count(*) into v_remaining from sos_arrival_codes
    where sos_id = p_sos and entered = false;

  if v_remaining = 0 then
    update sos_events set status = 'resolved', resolved_at = now()
    where id = p_sos and status = 'active';
    return jsonb_build_object('ok', true, 'wrong', false, 'all_done', true);
  end if;

  return jsonb_build_object('ok', true, 'wrong', false, 'all_done', false);
end $$;

revoke all on function public.submit_arrival_code(uuid, text, text) from public, anon;
grant execute on function public.submit_arrival_code(uuid, text, text) to authenticated;
