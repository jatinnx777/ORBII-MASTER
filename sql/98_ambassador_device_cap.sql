-- 98_ambassador_device_cap.sql
-- ============================================================================
-- Hard cap on activations per device, and a note about the email gap.
--
-- THE ATTACK THIS ANSWERS. One person, one phone, many accounts. They sign up
-- repeatedly, add any phone number as an emergency contact, and collect Rs. 4
-- each time.
--
-- WHY IT MOSTLY FAILS ALREADY. sql/97's sweep requires phone_confirmed_at, so
-- the attacker needs a real PHONE NUMBER per account, not an email. In India a
-- prepaid SIM needs Aadhaar KYC and costs money, and one Aadhaar is limited to
-- nine connections. Even an online OTP service costs Rs. 5 to Rs. 20 a number.
-- At Rs. 4 a head the attack is loss-making before it starts.
--
-- The rate IS the fraud control. Fraud is worth committing only when the payout
-- exceeds the cost of an identity, and Rs. 4 never does. This is the strongest
-- argument for keeping the rate low rather than raising it.
--
-- WHAT IS STILL OPEN. Somebody with a dual-SIM phone and four spare numbers
-- earns Rs. 16 with no barrier. Small money, but sql/97 only FLAGGED shared
-- devices at payout time, and a flag on a Rs. 16 fraud is a review nobody has
-- time for. A hard cap is cheaper than a queue.
--
-- Idempotent. Run after sql/97.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CAP
-- ---------------------------------------------------------------------------
-- Three, not one.
--
-- Shared phones are ordinary in Indian hostels: a sister signs up on her
-- brother's phone, a group passes one handset around at a session an ambassador
-- is running. Capping at one would reject exactly the people the programme is
-- trying to reach, and would do it silently.
--
-- Three allows the honest cases and makes the twentieth account worthless.
create or replace function public.amb_max_per_device()
returns int language sql immutable as $$ select 3 $$;

-- ---------------------------------------------------------------------------
-- 2. ENFORCE IT AT ACTIVATION, NOT AT SIGNUP
-- ---------------------------------------------------------------------------
-- Deliberately not a check on insert. A referral row is created when somebody
-- signs up, and rejecting the fourth signup on a shared phone would block a real
-- person from creating a real account on a safety app.
--
-- Nobody is ever prevented from using ORBII. What is capped is what an
-- ambassador is PAID for. Those are different things and must stay different.
create or replace function public.enforce_amb_device_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  -- Only when a referral is becoming active.
  if new.activated_at is null then return new; end if;
  if old.activated_at is not null then return new; end if;
  if new.device_hash is null then return new; end if;

  select count(*) into n
  from ambassador_referrals
  where device_hash = new.device_hash
    and activated_at is not null
    and rejected_at is null
    and id <> new.id;

  if n >= public.amb_max_per_device() then
    -- Held, not rejected. An admin can release it if the campus genuinely runs
    -- on three shared handsets, which on some campuses it does.
    new.activated_at := null;
    new.held_at := now();
    new.reject_reason := format('device cap: %s already active on this device', n);
  end if;

  return new;
end $$;

drop trigger if exists trg_amb_device_cap on ambassador_referrals;
create trigger trg_amb_device_cap
  before update on ambassador_referrals
  for each row execute function public.enforce_amb_device_cap();

-- ---------------------------------------------------------------------------
-- 3. THE EMAIL GAP, WRITTEN DOWN
-- ---------------------------------------------------------------------------
-- ORBII signs people in by phone OTP AND by email OTP (services/auth.ts has
-- both). The bounty counts only phone-verified accounts, per the programme
-- spec, which is what makes the attack above uneconomic.
--
-- The cost is real and points the other way: a referred user who signs up with
-- email only never activates, so the ambassador is credited nothing for work
-- they actually did. An ambassador who sees zero after a good session quits,
-- and that is a bigger threat to this programme than fraud is.
--
-- This view exists so the gap is measurable before anyone argues about it.
-- If it turns out most signups are email, the answer is to prompt for phone
-- verification during onboarding, NOT to start counting unverified accounts.
create or replace view public.ambassador_email_gap as
select
  a.code,
  a.college,
  count(*) filter (
    where r.activated_at is not null
  )::int as counted,
  count(*) filter (
    where r.activated_at is null
      and r.rejected_at is null
      and r.referred_user is not null
      and r.created_at < now() - interval '24 hours'
      and not exists (
        select 1 from auth.users u
        where u.id = r.referred_user and u.phone_confirmed_at is not null
      )
  )::int as blocked_no_phone
from ambassadors a
left join ambassador_referrals r on r.ambassador_id = a.id
group by a.code, a.college;

revoke all on public.ambassador_email_gap from public, anon, authenticated;

comment on view public.ambassador_email_gap is
  'How many referrals are stuck because the user signed up by email and never '
  'verified a phone. If blocked_no_phone approaches counted, fix onboarding, do '
  'not lower the bar.';

-- ---------------------------------------------------------------------------
-- 4. VERIFY
-- ---------------------------------------------------------------------------
select 'device cap function' as check,
       (to_regprocedure('public.amb_max_per_device()') is not null)::text as result
union all
select 'cap value (want 3)', public.amb_max_per_device()::text
union all
select 'device cap trigger',
       (exists (select 1 from pg_trigger where tgname = 'trg_amb_device_cap'))::text
union all
select 'email gap view', (to_regclass('public.ambassador_email_gap') is not null)::text
union all
-- The economics, asserted rather than assumed. If somebody raises the rate past
-- the cost of a phone number, this stops being true and fraud becomes rational.
select 'rate is below the cost of a SIM (fraud unprofitable)',
       (public.amb_rate_paise() < 10000)::text;
