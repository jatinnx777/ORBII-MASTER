-- 97_campus_ambassadors.sql
-- ============================================================================
-- Campus Ambassador programme: attribution, ledger, payouts.
--
-- SEPARATE FROM THE HELPER COIN ECONOMY, AND THAT IS DELIBERATE. Coins in
-- sql/28 are earned by physically turning up to a stranger's emergency, and
-- request_payout there reads its balance from helper_earnings. Putting a
-- marketing bounty in that ledger would make a referral and a rescue the same
-- number in the same table, and would dilute the one metric the responder
-- network runs on. Different money, different table, different rules: an
-- ambassador credit is reversible while it is pending, a rescue reward never is.
--
-- ECONOMICS (3 month sprint term)
--   Rs. 4 per verified active user
--   Stacking milestone bonuses at 25 / 50 / 100 / 250: 0 / 50 / 100 / 250
--   So 250 users pays 1000 base + 400 bonuses = Rs. 1400
--   Withdrawal unlocks at Rs. 100
--
-- Money is in PAISE end to end, matching sql/28, because floats and rupees do
-- not mix.
--
-- Idempotent. Run after sql/96.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. TUNABLES, in one place so they are arguable rather than buried
-- ---------------------------------------------------------------------------
create or replace function public.amb_rate_paise()
returns int language sql immutable as $$ select 400 $$;   -- Rs. 4

create or replace function public.amb_min_withdrawal_paise()
returns int language sql immutable as $$ select 10000 $$; -- Rs. 100

/**
 * Milestones as (users, bonus_paise). Bonuses STACK: crossing 250 having passed
 * 50 and 100 pays all three.
 */
create or replace function public.amb_milestones()
returns table (users int, bonus_paise int)
language sql immutable as $$
  values (25, 0), (50, 5000), (100, 10000), (250, 25000)
$$;

-- ---------------------------------------------------------------------------
-- 2. AMBASSADORS
-- ---------------------------------------------------------------------------
create table if not exists ambassadors (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Typed by hand on a signup screen, so uppercase and no ambiguous glyphs.
  -- The check rejects O and I outright rather than trusting a human to tell
  -- them from 0 and 1 while standing in a corridor.
  code        text not null unique
                check (code ~ '^[A-HJ-NP-Z0-9]{4,12}$'),
  college     text not null,
  term        text not null,
  status      text not null default 'active'
                check (status in ('active', 'paused', 'removed')),
  upi_id      text,
  created_at  timestamptz not null default now(),
  unique (user_id, term)
);

create index if not exists ambassadors_code_idx on ambassadors (upper(code));
create index if not exists ambassadors_term_idx on ambassadors (term, status);

alter table ambassadors enable row level security;

drop policy if exists "amb read own" on ambassadors;
create policy "amb read own" on ambassadors
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. REFERRALS
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL, NOT CASCADE. This is the single most important line in
-- the file.
--
-- ORBII ships account deletion (DPDP, and there is a /delete-account page). If
-- this cascaded, a user exercising their right to erasure would delete the
-- referral row, the ambassador's count would drop retroactively, and a bonus
-- already paid at 25 users would have no basis in the ledger. Somebody who did
-- the work would watch their number go down for a reason nobody could explain
-- to them.
--
-- So the referral row survives with a null user and a tombstone timestamp. It
-- holds no personal data once cleared: no name, no phone, no email.
create table if not exists ambassador_referrals (
  id             uuid primary key default gen_random_uuid(),
  ambassador_id  uuid not null references ambassadors(id) on delete cascade,
  referred_user  uuid references auth.users(id) on delete set null,
  user_deleted_at timestamptz,
  source         text not null
                   check (source in ('deep_link', 'signup_code', 'manual')),
  device_hash    text,
  signup_ip_hash text,
  -- Null until all three conditions AND the 24h retention window pass.
  activated_at   timestamptz,
  rejected_at    timestamptz,
  reject_reason  text,
  -- Set by the risk pass. A held referral earns nothing until an admin acts.
  held_at        timestamptz,
  created_at     timestamptz not null default now()
);

-- A user can be referred exactly ONCE, ever, by anyone. This constraint is the
-- fraud control that needs no heuristic behind it: it makes double-claiming
-- structurally impossible rather than merely detectable.
create unique index if not exists ambassador_referrals_user_uq
  on ambassador_referrals (referred_user)
  where referred_user is not null;

create index if not exists ambassador_referrals_amb_idx
  on ambassador_referrals (ambassador_id, activated_at);
create index if not exists ambassador_referrals_device_idx
  on ambassador_referrals (device_hash, created_at desc)
  where device_hash is not null;

alter table ambassador_referrals enable row level security;

-- Counts only, never rows. An ambassador must not learn WHICH of their friends
-- signed up for a women's safety app; that is the referred person's business,
-- and on this product it is the kind of thing somebody could be harmed by.
drop policy if exists "amb referrals admin only" on ambassador_referrals;
create policy "amb referrals admin only" on ambassador_referrals
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. LEDGER, append only
-- ---------------------------------------------------------------------------
-- Nothing here is ever UPDATEd except state. A correction is a new negative
-- row, so the history of what we thought we owed is preserved. When an
-- ambassador disputes a number, the answer is a query, not a memory.
create table if not exists ambassador_ledger (
  id             bigint generated always as identity primary key,
  ambassador_id  uuid not null references ambassadors(id) on delete cascade,
  referral_id    uuid references ambassador_referrals(id) on delete set null,
  kind           text not null
                   check (kind in ('base', 'milestone', 'grand_prize', 'adjustment')),
  -- Which milestone this bonus is for. Null for base credits. Part of the
  -- idempotency key below.
  milestone      int,
  paise          int not null,
  state          text not null default 'pending'
                   check (state in ('pending', 'cleared', 'reversed')),
  note           text,
  created_at     timestamptz not null default now(),
  cleared_at     timestamptz
);

-- One base credit per referral, ever. If the activation job runs twice, or a
-- referral is re-activated after a reversal, the second insert fails rather
-- than paying twice.
create unique index if not exists ambassador_ledger_base_uq
  on ambassador_ledger (referral_id)
  where kind = 'base' and referral_id is not null;

-- One bonus per milestone per ambassador, ever. Without this, an ambassador who
-- crosses 50, drops to 49 on a reversal, then crosses 50 again collects the
-- Rs. 50 twice.
create unique index if not exists ambassador_ledger_milestone_uq
  on ambassador_ledger (ambassador_id, milestone)
  where kind = 'milestone';

create index if not exists ambassador_ledger_balance_idx
  on ambassador_ledger (ambassador_id, state);

alter table ambassador_ledger enable row level security;

drop policy if exists "amb ledger read own" on ambassador_ledger;
create policy "amb ledger read own" on ambassador_ledger
  for select to authenticated
  using (
    public.is_admin()
    or ambassador_id in (select id from ambassadors where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 5. PAYOUTS
-- ---------------------------------------------------------------------------
create table if not exists ambassador_payouts (
  id             bigint generated always as identity primary key,
  ambassador_id  uuid not null references ambassadors(id) on delete cascade,
  paise          int not null check (paise > 0),
  state          text not null default 'requested'
                   check (state in ('requested', 'approved', 'paid', 'rejected')),
  method         text not null default 'upi' check (method in ('upi', 'bank')),
  upi_id         text,
  utr            text,
  risk_flags     jsonb not null default '[]'::jsonb,
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references auth.users(id) on delete set null,
  note           text
);

-- ONE open request at a time. Two taps on a slow connection is two rows and two
-- UPI transfers, and the second one is money we never get back.
create unique index if not exists ambassador_payouts_open_uq
  on ambassador_payouts (ambassador_id)
  where state in ('requested', 'approved');

create index if not exists ambassador_payouts_queue_idx
  on ambassador_payouts (state, requested_at);

alter table ambassador_payouts enable row level security;

drop policy if exists "amb payouts read own" on ambassador_payouts;
create policy "amb payouts read own" on ambassador_payouts
  for select to authenticated
  using (
    public.is_admin()
    or ambassador_id in (select id from ambassadors where user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 6. THE BALANCE
-- ---------------------------------------------------------------------------
-- A single definition, used by the dashboard, the withdrawal check and the
-- admin queue. Three copies of "what do we owe" is three chances to disagree
-- about it on payout day.
--
-- WHAT COUNTS AGAINST THE BALANCE. Only 'cleared' credits, and only payouts
-- that are not 'rejected'. A rejected payout must not permanently reduce a
-- balance, and a pending credit must not be withdrawable before the retention
-- window closes.
create or replace function public.ambassador_summary(p_ambassador uuid default null)
returns table (
  ambassador_id       uuid,
  code                text,
  college             text,
  active_user_count   int,
  pending_count       int,
  total_earned_paise  bigint,
  cleared_paise       bigint,
  paid_paise          bigint,
  unpaid_balance_paise bigint,
  next_milestone      int,
  can_withdraw        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select a.id, a.code, a.college
    from ambassadors a
    where (p_ambassador is not null and a.id = p_ambassador)
       or (p_ambassador is null and a.user_id = auth.uid())
  ),
  counts as (
    select
      m.id,
      count(*) filter (where r.activated_at is not null and r.rejected_at is null)::int as active,
      count(*) filter (where r.activated_at is null and r.rejected_at is null)::int as pending
    from me m
    left join ambassador_referrals r on r.ambassador_id = m.id
    group by m.id
  ),
  money as (
    select
      m.id,
      coalesce(sum(l.paise) filter (where l.state <> 'reversed'), 0)::bigint as earned,
      coalesce(sum(l.paise) filter (where l.state = 'cleared'), 0)::bigint as cleared
    from me m
    left join ambassador_ledger l on l.ambassador_id = m.id
    group by m.id
  ),
  paid as (
    select
      m.id,
      coalesce(sum(p.paise) filter (where p.state <> 'rejected'), 0)::bigint as out
    from me m
    left join ambassador_payouts p on p.ambassador_id = m.id
    group by m.id
  )
  select
    m.id,
    m.code,
    m.college,
    c.active,
    c.pending,
    mo.earned,
    mo.cleared,
    pd.out,
    greatest(0, mo.cleared - pd.out),
    (select min(ms.users) from public.amb_milestones() ms where ms.users > c.active),
    greatest(0, mo.cleared - pd.out) >= public.amb_min_withdrawal_paise()
  from me m
  join counts c on c.id = m.id
  join money mo on mo.id = m.id
  join paid pd on pd.id = m.id;
$$;

revoke all on function public.ambassador_summary(uuid) from public, anon;
grant execute on function public.ambassador_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. ACTIVATION AND CREDITING
-- ---------------------------------------------------------------------------
-- Run on a schedule. Marks referrals active once all conditions hold, writes
-- the base credit, then tops up any milestone bonuses now earned.
--
-- ACTIVATION IS ONE WAY. Once activated_at is set it is never cleared, even if
-- the user later deletes their emergency contacts. Retroactively withdrawing a
-- number an ambassador already saw and planned around is a worse failure than
-- occasionally paying Rs. 4 for a user who changed their mind.
create or replace function public.ambassador_activation_sweep()
returns table (activated int, credited int, bonuses int)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_act int := 0;
  n_cred int := 0;
  n_bonus int := 0;
begin
  -- 1. Activate referrals whose conditions now hold.
  with eligible as (
    select r.id
    from ambassador_referrals r
    join ambassadors a on a.id = r.ambassador_id and a.status = 'active'
    where r.activated_at is null
      and r.rejected_at is null
      and r.held_at is null
      and r.referred_user is not null
      -- 24 hour retention window. The point is not that the app is still
      -- installed, which we cannot see, but that a full day passed without the
      -- account being deleted or flagged.
      and r.created_at < now() - interval '24 hours'
      -- Phone verified. Supabase writes this on OTP confirmation.
      and exists (
        select 1 from auth.users u
        where u.id = r.referred_user and u.phone_confirmed_at is not null
      )
      -- At least one emergency contact.
      and exists (
        select 1 from emergency_contacts ec where ec.user_id = r.referred_user
      )
      -- Never the ambassador referring themselves.
      and r.referred_user <> a.user_id
  )
  update ambassador_referrals r
     set activated_at = now()
    from eligible e
   where r.id = e.id;
  get diagnostics n_act = row_count;

  -- 2. Base credit, one per referral. The partial unique index makes a second
  --    run a no-op rather than a double payment.
  insert into ambassador_ledger (ambassador_id, referral_id, kind, paise, state, cleared_at, note)
  select r.ambassador_id, r.id, 'base', public.amb_rate_paise(), 'cleared', now(),
         'verified active user'
  from ambassador_referrals r
  where r.activated_at is not null
    and r.rejected_at is null
    and not exists (
      select 1 from ambassador_ledger l
      where l.referral_id = r.id and l.kind = 'base'
    )
  on conflict do nothing;
  get diagnostics n_cred = row_count;

  -- 3. Stacking milestone bonuses. Every milestone at or below the current
  --    count that has not been paid yet.
  insert into ambassador_ledger (ambassador_id, kind, milestone, paise, state, cleared_at, note)
  select a.id, 'milestone', ms.users, ms.bonus_paise, 'cleared', now(),
         format('milestone %s users', ms.users)
  from ambassadors a
  cross join public.amb_milestones() ms
  where ms.bonus_paise > 0
    and ms.users <= (
      select count(*) from ambassador_referrals r
      where r.ambassador_id = a.id
        and r.activated_at is not null
        and r.rejected_at is null
    )
    and not exists (
      select 1 from ambassador_ledger l
      where l.ambassador_id = a.id and l.kind = 'milestone' and l.milestone = ms.users
    )
  on conflict do nothing;
  get diagnostics n_bonus = row_count;

  activated := n_act; credited := n_cred; bonuses := n_bonus;
  return next;
end $$;

revoke all on function public.ambassador_activation_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. WITHDRAWAL REQUEST
-- ---------------------------------------------------------------------------
create or replace function public.ambassador_request_payout(p_upi text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  amb   record;
  bal   bigint;
  flags jsonb := '[]'::jsonb;
  burst int;
begin
  select a.* into amb from ambassadors a where a.user_id = auth.uid() and a.status = 'active';
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_an_ambassador');
  end if;

  -- Serialise. Two taps on a slow connection is otherwise two rows, and the
  -- partial unique index would surface as a raw constraint error instead of a
  -- sentence.
  perform 1 from ambassadors where id = amb.id for update;

  if exists (
    select 1 from ambassador_payouts
    where ambassador_id = amb.id and state in ('requested', 'approved')
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_requested',
      'message', 'You already have a withdrawal in progress.');
  end if;

  select unpaid_balance_paise into bal
  from public.ambassador_summary(amb.id);

  if coalesce(bal, 0) < public.amb_min_withdrawal_paise() then
    return jsonb_build_object('ok', false, 'reason', 'below_threshold',
      'balance_paise', coalesce(bal, 0),
      'needed_paise', public.amb_min_withdrawal_paise(),
      'message', 'You need Rs. 100 before you can withdraw.');
  end if;

  -- Risk flags. These do NOT block; they route to manual review. A legitimate
  -- ambassador who ran a packed hostel session genuinely does produce a burst,
  -- and auto-rejecting them would be the worst possible message to send.
  select count(*) into burst
  from ambassador_referrals r
  where r.ambassador_id = amb.id
    and r.created_at > now() - interval '30 minutes';
  if burst > 15 then
    flags := flags || jsonb_build_array('burst_30m');
  end if;

  if exists (
    select 1 from ambassador_referrals r
    where r.ambassador_id = amb.id and r.device_hash is not null
    group by r.device_hash having count(*) > 2
  ) then
    flags := flags || jsonb_build_array('shared_device');
  end if;

  insert into ambassador_payouts (ambassador_id, paise, method, upi_id, risk_flags)
  values (amb.id, bal, 'upi', p_upi, flags);

  return jsonb_build_object('ok', true, 'paise', bal,
    'review', jsonb_array_length(flags) > 0,
    'message', case when jsonb_array_length(flags) > 0
      then 'Requested. This one needs a quick check first, usually within a day.'
      else 'Requested. Paid within 7 days.' end);
end $$;

revoke all on function public.ambassador_request_payout(text) from public, anon;
grant execute on function public.ambassador_request_payout(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. VERIFY
-- ---------------------------------------------------------------------------
select 'ambassadors table' as check,
       (to_regclass('public.ambassadors') is not null)::text as result
union all
select 'referrals table', (to_regclass('public.ambassador_referrals') is not null)::text
union all
select 'ledger table', (to_regclass('public.ambassador_ledger') is not null)::text
union all
select 'payouts table', (to_regclass('public.ambassador_payouts') is not null)::text
union all
select 'one referral per user (fraud control)',
       (to_regclass('public.ambassador_referrals_user_uq') is not null)::text
union all
select 'one base credit per referral',
       (to_regclass('public.ambassador_ledger_base_uq') is not null)::text
union all
select 'one bonus per milestone',
       (to_regclass('public.ambassador_ledger_milestone_uq') is not null)::text
union all
select 'one open payout at a time',
       (to_regclass('public.ambassador_payouts_open_uq') is not null)::text
union all
select 'summary rpc', (to_regprocedure('public.ambassador_summary(uuid)') is not null)::text
union all
select 'Tier 4 pays 1400 (1000 base + 400 stacked bonuses)',
       ((250 * public.amb_rate_paise() + (select sum(bonus_paise) from public.amb_milestones()))
        = 140000)::text;
