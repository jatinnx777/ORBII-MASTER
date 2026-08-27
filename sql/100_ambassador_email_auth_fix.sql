-- 100_ambassador_email_auth_fix.sql
-- ============================================================================
-- Two fixes. The first one is why nobody has been paid.
--
-- FIX 1: NOTHING ACTIVATES. sql/97's sweep requires phone_confirmed_at. ORBII
-- signs people in with EMAIL OTP and Google OAuth and never sends an SMS, so
-- that column is null for every user who has ever existed. Every referral has
-- been sitting pending and no ambassador would ever have seen a single rupee.
-- A programme that silently pays nothing is worse than no programme, because
-- students do the work first and find out later.
--
-- FIX 2: THE PAYWALL WAS IMAGINARY. sql/98 argued that Rs. 4 is below the cost
-- of a phone number, so farming is loss-making. That reasoning assumed SMS OTP.
-- With email, an identity costs ZERO, and twenty Gmail accounts is an afternoon.
-- The economics no longer defend anything and the structure has to.
--
-- Idempotent. Run after sql/99.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHAT COUNTS AS A VERIFIED IDENTITY NOW
-- ---------------------------------------------------------------------------
-- Supabase sets email_confirmed_at on an email OTP verification AND on a Google
-- OAuth sign-in, since Google has already proven the address. confirmed_at is
-- the generated coalesce of the email and phone columns, so it covers both
-- today and keeps working unchanged on the day SMS OTP is added.
create or replace function public.amb_identity_verified(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from auth.users u
    where u.id = p_user and u.confirmed_at is not null
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. THE STRUCTURAL REPLACEMENT FOR THE MISSING PAYWALL
-- ---------------------------------------------------------------------------
-- An emergency contact is a phone number TYPED INTO A BOX. It proves nothing:
-- a farmer types ten digits and moves on. It was a reasonable activation signal
-- when an SMS OTP stood in front of it. It is not one now.
--
-- A CIRCLE MEMBER IS DIFFERENT. It requires a second account that signed up and
-- ACCEPTED an invite. That doubles the accounts a farmer needs, and it is the
-- only signal ORBII already collects that cannot be satisfied by typing.
--
-- It is also the honest definition of an activated safety-app user. Somebody
-- with a circle has actually started using ORBII for the thing ORBII is for.
--
-- Left as a switch rather than hardcoded, because if real activation rates come
-- in too low the answer might be to relax this rather than to widen the fraud
-- door. Flip it knowing what it costs.
create or replace function public.amb_require_circle_member()
returns boolean language sql immutable as $$ select true $$;

/**
 * Seven days, not twenty-four hours.
 *
 * A credit stays `pending` this long before it can be withdrawn. With a free
 * identity, reversibility is the control that actually matters: it turns fraud
 * from money already sent over UPI into a database update. A farmer has to keep
 * twenty accounts alive for a week to get Rs. 80.
 */
create or replace function public.amb_clearing_days()
returns int language sql immutable as $$ select 7 $$;

-- ---------------------------------------------------------------------------
-- 3. THE CORRECTED SWEEP
-- ---------------------------------------------------------------------------
create or replace function public.ambassador_activation_sweep()
returns table (activated int, credited int, bonuses int, cleared int)
language plpgsql
security definer
set search_path = public
as $$
declare
  n_act int := 0;
  n_cred int := 0;
  n_bonus int := 0;
  n_clear int := 0;
begin
  -- 1. Activate.
  with eligible as (
    select r.id
    from ambassador_referrals r
    join ambassadors a on a.id = r.ambassador_id and a.status = 'active'
    where r.activated_at is null
      and r.rejected_at is null
      and r.held_at is null
      and r.referred_user is not null
      and r.created_at < now() - interval '24 hours'
      -- Email OTP or Google, not the phone column that is always null here.
      and public.amb_identity_verified(r.referred_user)
      -- Still the published definition: an emergency profile with a contact.
      and exists (
        select 1 from emergency_contacts ec where ec.user_id = r.referred_user
      )
      -- The anti-farming condition. A live circle membership the person did not
      -- create alone: somebody else accepted, or they accepted somebody else's.
      and (
        not public.amb_require_circle_member()
        or exists (
          select 1
          from circle_members m
          join circle_members other
            on other.circle_id = m.circle_id
           and other.user_id <> m.user_id
           and other.deleted_at is null
          where m.user_id = r.referred_user
            and m.deleted_at is null
        )
      )
      and r.referred_user <> a.user_id
  )
  update ambassador_referrals r
     set activated_at = now()
    from eligible e
   where r.id = e.id;
  get diagnostics n_act = row_count;

  -- 2. Base credit, PENDING now rather than cleared. This is the change that
  --    makes fraud reversible instead of refundable.
  insert into ambassador_ledger (ambassador_id, referral_id, kind, paise, state, note)
  select r.ambassador_id, r.id, 'base', public.amb_rate_paise(), 'pending',
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

  -- 3. Stacking milestone bonuses, also pending.
  insert into ambassador_ledger (ambassador_id, kind, milestone, paise, state, note)
  select a.id, 'milestone', ms.users, ms.bonus_paise, 'pending',
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

  -- 4. Clear anything old enough, and only where the underlying referral is
  --    still healthy. A referral rejected during the window never clears.
  update ambassador_ledger l
     set state = 'cleared', cleared_at = now()
   where l.state = 'pending'
     and l.created_at < now() - make_interval(days => public.amb_clearing_days())
     and (
       l.referral_id is null
       or exists (
         select 1 from ambassador_referrals r
         where r.id = l.referral_id
           and r.rejected_at is null
           and r.held_at is null
       )
     );
  get diagnostics n_clear = row_count;

  activated := n_act; credited := n_cred; bonuses := n_bonus; cleared := n_clear;
  return next;
end $$;

revoke all on function public.ambassador_activation_sweep() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. WHAT THIS DOES NOT SOLVE, STATED PLAINLY
-- ---------------------------------------------------------------------------
-- The device cap in sql/98 is weaker than it reads. getDeviceId() in
-- services/rewards/FraudDetectionService.ts is a random string kept in
-- AsyncStorage:
--
--   id = `dev_${Date.now().toString(36)}_${Math.random()...}`
--
-- Clearing app data resets it. A farmer defeats the cap in ten seconds.
--
-- The real fix is Settings.Secure.ANDROID_ID, which survives reinstall and app
-- data clear and only changes on a factory reset. That needs expo-application,
-- which is not currently a dependency:
--
--   npx expo install expo-application
--   Application.getAndroidId()
--
-- That is the single highest-value change available here, and it is one
-- dependency and about ten lines. Until it ships, the device cap is friction,
-- not a wall.
--
-- AND THE HONEST LIMIT. With a free identity, no automated rule fully stops a
-- determined farmer. At 9 ambassadors the correct control is not a better
-- heuristic, it is reading the first withdrawal of every ambassador by hand.
-- Ten minutes, and it is 100 percent effective at this size. Automate when
-- there are fifty.

-- ---------------------------------------------------------------------------
-- 5. WHO IS STUCK, AND WHY
-- ---------------------------------------------------------------------------
-- Replaces the email-gap view from sql/98, which was measuring the wrong thing
-- now that email IS the auth method.
drop view if exists public.ambassador_email_gap;

create or replace view public.ambassador_activation_gap as
select
  a.code,
  a.college,
  count(*) filter (where r.activated_at is not null)::int as activated,
  count(*) filter (
    where r.activated_at is null and r.rejected_at is null
      and r.referred_user is not null
      and not public.amb_identity_verified(r.referred_user)
  )::int as blocked_unverified,
  count(*) filter (
    where r.activated_at is null and r.rejected_at is null
      and r.referred_user is not null
      and not exists (select 1 from emergency_contacts ec where ec.user_id = r.referred_user)
  )::int as blocked_no_contact,
  count(*) filter (
    where r.activated_at is null and r.rejected_at is null
      and r.referred_user is not null
      and not exists (
        select 1 from circle_members m
        join circle_members o on o.circle_id = m.circle_id and o.user_id <> m.user_id
         and o.deleted_at is null
        where m.user_id = r.referred_user and m.deleted_at is null
      )
  )::int as blocked_no_circle
from ambassadors a
left join ambassador_referrals r on r.ambassador_id = a.id
group by a.code, a.college;

revoke all on public.ambassador_activation_gap from public, anon, authenticated;

comment on view public.ambassador_activation_gap is
  'Why referrals are not activating. If blocked_no_circle dwarfs the rest, the '
  'circle requirement is too strict for real users and onboarding should push '
  'circle setup harder before the rule is relaxed.';

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'identity check covers email/OAuth' as check,
       (to_regprocedure('public.amb_identity_verified(uuid)') is not null)::text as result
union all
select 'sweep no longer requires phone_confirmed_at',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_activation_sweep')
                 not like '%phone_confirmed_at%', false))::text
union all
select 'circle member required (anti-farming)', public.amb_require_circle_member()::text
union all
select 'clearing window in days', public.amb_clearing_days()::text
union all
select 'activation gap view',
       (to_regclass('public.ambassador_activation_gap') is not null)::text
union all
-- How many real users would activate right now. If this is 0 on a database with
-- users, something else is wrong and the programme still pays nothing.
select 'users who would qualify today',
       (select count(*)::text from auth.users u
        where u.confirmed_at is not null
          and exists (select 1 from emergency_contacts ec where ec.user_id = u.id));
