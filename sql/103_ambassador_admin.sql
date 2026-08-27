-- 103_ambassador_admin.sql
-- ============================================================================
-- Admin tools: add an ambassador, and see how everyone is doing.
--
-- Until now the only way to create an ambassador was to hand-write an INSERT
-- with a uuid subquery. That is fine once and a mistake waiting to happen nine
-- times, so this does it from the admin page with an email address.
--
-- EVERY FUNCTION HERE IS GATED ON is_admin(). They are SECURITY DEFINER and they
-- read other people's earnings, which is exactly the shape of the bug sql/102
-- had to fix. The check is the first statement in each one, not a clause folded
-- into a query.
--
-- Idempotent. Run after sql/102.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ADD AN AMBASSADOR BY EMAIL
-- ---------------------------------------------------------------------------
-- Returns jsonb rather than raising, because every failure here is something a
-- person did (wrong email, code already taken) and deserves a sentence rather
-- than a Postgres error code on a screen.
create or replace function public.admin_add_ambassador(
  p_email   text,
  p_code    text,
  p_college text,
  p_term    text default '2026-autumn'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid;
  norm text;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  norm := upper(btrim(coalesce(p_code, '')));

  -- Same alphabet the app validates against: no O and no I, so nobody has to
  -- tell them from 0 and 1 while reading a poster.
  if norm !~ '^[A-HJ-NP-Z0-9]{4,12}$' then
    return jsonb_build_object('ok', false,
      'message', 'Code must be 4 to 12 characters, A to Z and 0 to 9, and cannot contain O or I.');
  end if;

  select u.id into uid
  from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')));

  if uid is null then
    return jsonb_build_object('ok', false,
      'message', 'No ORBII account with that email. They have to sign up in the app first.');
  end if;

  if exists (select 1 from ambassadors where upper(code) = norm) then
    return jsonb_build_object('ok', false, 'message', 'That code is already taken.');
  end if;

  if exists (select 1 from ambassadors where user_id = uid and term = p_term) then
    return jsonb_build_object('ok', false,
      'message', 'That person is already an ambassador this term.');
  end if;

  insert into ambassadors (user_id, code, college, term)
  values (uid, norm, btrim(p_college), p_term);

  return jsonb_build_object('ok', true, 'code', norm,
    'message', 'Added. Send them orbii.in/ambassador.');
end $$;

revoke all on function public.admin_add_ambassador(text, text, text, text) from public, anon;
grant execute on function public.admin_add_ambassador(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. PAUSE OR REMOVE ONE
-- ---------------------------------------------------------------------------
-- Status changes rather than deletes. Deleting an ambassador would cascade
-- their referrals and ledger away, and money already earned should survive
-- somebody leaving the programme.
create or replace function public.admin_set_ambassador_status(
  p_code   text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  if p_status not in ('active', 'paused', 'removed') then
    return jsonb_build_object('ok', false, 'message', 'Status must be active, paused or removed.');
  end if;

  update ambassadors set status = p_status
  where upper(code) = upper(btrim(coalesce(p_code, '')));

  if not found then
    return jsonb_build_object('ok', false, 'message', 'No ambassador with that code.');
  end if;
  return jsonb_build_object('ok', true, 'message', 'Updated.');
end $$;

revoke all on function public.admin_set_ambassador_status(text, text) from public, anon;
grant execute on function public.admin_set_ambassador_status(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. THE LEADERBOARD
-- ---------------------------------------------------------------------------
-- Everything you need to decide who gets the monthly prize and whether anybody
-- is farming, in one query.
--
-- signups is every person who typed the code. counted is the ones who finished
-- setting up. The RATIO between them is the most useful fraud signal you have:
-- a real ambassador's people mostly finish, and a farm's mostly do not, because
-- finishing needs a second real person in a circle.
create or replace function public.admin_ambassador_leaderboard()
returns table (
  code             text,
  college          text,
  email            text,
  status           text,
  signups          int,
  counted          int,
  waiting          int,
  earned_paise     bigint,
  ready_paise      bigint,
  paid_paise       bigint,
  open_payout      boolean,
  devices_used     int,
  joined           timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.code,
    a.college,
    u.email::text,
    a.status,
    count(r.id)::int,
    count(r.id) filter (where r.activated_at is not null)::int,
    count(r.id) filter (where r.activated_at is null and r.rejected_at is null)::int,
    coalesce((select sum(l.paise) from ambassador_ledger l
              where l.ambassador_id = a.id and l.state <> 'reversed'), 0)::bigint,
    coalesce((select sum(l.paise) from ambassador_ledger l
              where l.ambassador_id = a.id and l.state = 'cleared'), 0)::bigint,
    coalesce((select sum(p.paise) from ambassador_payouts p
              where p.ambassador_id = a.id and p.state <> 'rejected'), 0)::bigint,
    exists (select 1 from ambassador_payouts p
            where p.ambassador_id = a.id and p.state in ('requested', 'approved')),
    -- How many distinct phones their signups came from. One ambassador with 20
    -- signups from 2 devices is the single clearest thing to look at.
    count(distinct r.device_hash)::int,
    a.created_at
  from ambassadors a
  left join auth.users u on u.id = a.user_id
  left join ambassador_referrals r on r.ambassador_id = a.id
  where public.is_admin()
  group by a.id, a.code, a.college, u.email, a.status, a.created_at
  order by count(r.id) filter (where r.activated_at is not null) desc, a.code;
$$;

revoke all on function public.admin_ambassador_leaderboard() from public, anon;
grant execute on function public.admin_ambassador_leaderboard() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. PAYOUT QUEUE
-- ---------------------------------------------------------------------------
create or replace function public.admin_ambassador_payouts()
returns table (
  id          bigint,
  code        text,
  college     text,
  paise       int,
  state       text,
  upi_id      text,
  risk_flags  jsonb,
  requested_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, a.code, a.college, p.paise, p.state, p.upi_id, p.risk_flags, p.requested_at
  from ambassador_payouts p
  join ambassadors a on a.id = p.ambassador_id
  where public.is_admin() and p.state in ('requested', 'approved')
  order by p.requested_at;
$$;

revoke all on function public.admin_ambassador_payouts() from public, anon;
grant execute on function public.admin_ambassador_payouts() to authenticated;

-- Mark one paid, with the UTR from the UPI app.
create or replace function public.admin_mark_ambassador_paid(p_id bigint, p_utr text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update ambassador_payouts
     set state = 'paid', utr = nullif(btrim(coalesce(p_utr, '')), ''),
         decided_at = now(), decided_by = auth.uid()
   where id = p_id and state in ('requested', 'approved');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Not found, or already settled.');
  end if;
  return jsonb_build_object('ok', true, 'message', 'Marked paid.');
end $$;

revoke all on function public.admin_mark_ambassador_paid(bigint, text) from public, anon;
grant execute on function public.admin_mark_ambassador_paid(bigint, text) to authenticated;

create or replace function public.admin_reject_ambassador_payout(p_id bigint, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  update ambassador_payouts
     set state = 'rejected', note = btrim(coalesce(p_note, '')),
         decided_at = now(), decided_by = auth.uid()
   where id = p_id and state in ('requested', 'approved');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'Not found, or already settled.');
  end if;
  -- Rejecting does NOT take the money away. The balance returns to withdrawable
  -- and they can ask again. If the earnings themselves are bad, reverse the
  -- ledger rows; do not use a rejected payout to do it quietly.
  return jsonb_build_object('ok', true, 'message', 'Rejected. Their balance is untouched.');
end $$;

revoke all on function public.admin_reject_ambassador_payout(bigint, text) from public, anon;
grant execute on function public.admin_reject_ambassador_payout(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. MAKE THE FOUNDER THE FIRST AMBASSADOR
-- ---------------------------------------------------------------------------
-- So the whole chain can be tested end to end before a poster goes anywhere:
-- sign in at orbii.in/ambassador, see the dashboard, hand the code to a second
-- phone, and watch the number move.
do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = 'jaykumar2470f@gmail.com';
  if uid is null then
    raise notice 'No account for jaykumar2470f@gmail.com yet. Sign in to the app once, then re-run this file.';
  elsif exists (select 1 from ambassadors where user_id = uid and term = '2026-autumn') then
    raise notice 'Already an ambassador this term.';
  else
    insert into ambassadors (user_id, code, college, term)
    values (uid, 'ORBII01', 'SRM University Sonepat', '2026-autumn');
    raise notice 'Added as ORBII01.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'add ambassador rpc' as check,
       (to_regprocedure('public.admin_add_ambassador(text,text,text,text)') is not null)::text as result
union all
select 'leaderboard rpc',
       (to_regprocedure('public.admin_ambassador_leaderboard()') is not null)::text
union all
select 'payout queue rpc',
       (to_regprocedure('public.admin_ambassador_payouts()') is not null)::text
union all
select 'founder is an ambassador',
       (exists (select 1 from ambassadors a join auth.users u on u.id = a.user_id
                where lower(u.email) = 'jaykumar2470f@gmail.com'))::text
union all
select 'your code',
       coalesce((select a.code from ambassadors a join auth.users u on u.id = a.user_id
                 where lower(u.email) = 'jaykumar2470f@gmail.com' limit 1), 'NOT SET');
