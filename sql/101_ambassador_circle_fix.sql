-- 101_ambassador_circle_fix.sql
-- ============================================================================
-- The circle requirement in sql/100 did not do what its own comment claimed.
--
-- WHAT I GOT WRONG. sql/100 says a circle member "requires a SECOND account
-- that signed up and accepted an invite, which doubles what a farmer needs".
-- It does not, because sql/09 puts no limit on how many circles one user may
-- join. The cap is 4 members PER CIRCLE, not N circles per person.
--
-- So the farm is: create 20 email accounts, then add your own ambassador
-- account to all 20 circles. Every one of them now has a circle containing
-- another live member and activates. One real account satisfies twenty
-- referrals at zero extra cost, which is the opposite of doubling anything.
--
-- THE FIX. The other member must not be the ambassador being paid for it. An
-- ambassador vouching for their own referral is not evidence of anything.
--
-- Idempotent. Run after sql/100.
-- ============================================================================

-- 42P13: create or replace cannot change a return type, and this adds a fourth
-- output column (cleared) to the three sql/97 declared. Dropping first is the
-- documented workaround in ORBII_STATE's Postgres gotchas.
--
-- Safe: nothing holds a reference to this function. It is called by a scheduled
-- job, not by a view or a foreign key.
drop function if exists public.ambassador_activation_sweep();

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
  with eligible as (
    select r.id
    from ambassador_referrals r
    join ambassadors a on a.id = r.ambassador_id and a.status = 'active'
    where r.activated_at is null
      and r.rejected_at is null
      and r.held_at is null
      and r.referred_user is not null
      and r.created_at < now() - interval '24 hours'
      and public.amb_identity_verified(r.referred_user)
      and exists (
        select 1 from emergency_contacts ec where ec.user_id = r.referred_user
      )
      and (
        not public.amb_require_circle_member()
        or exists (
          select 1
          from circle_members m
          join circle_members other
            on other.circle_id = m.circle_id
           and other.user_id <> m.user_id
           and other.deleted_at is null
           -- THE FIX. The corroborating member cannot be the ambassador who
           -- gets paid for this referral. Without this line one ambassador
           -- account vouches for every account they created.
           and other.user_id <> a.user_id
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
-- WHAT THIS STILL DOES NOT STOP, and the honest arithmetic
-- ---------------------------------------------------------------------------
-- A farmer can pair their fake accounts with EACH OTHER. Account A's circle
-- holds B, B's circle holds A, and neither is the ambassador. Twenty accounts
-- still yields twenty activations. The ratio is 1:1, not the 2:1 sql/100
-- claimed.
--
-- WHY THAT IS NOT CLOSED HERE. The obvious next rule is "the corroborating
-- member must not also be referred by this ambassador". It would work, and it
-- would reject the most ordinary honest case on a campus: two roommates
-- recruited at the same session who add each other. Losing real ambassadors to
-- a false rejection costs more than Rs. 80 of fraud.
--
-- SO THE WALL IS THE DEVICE CAP, not the circle rule. Three activations per
-- ANDROID_ID, which survives reinstall and app-data clear, means twenty
-- accounts needs seven physical phones. That is the barrier. The circle rule
-- removes the free one-account-vouches-for-all attack; the device cap makes the
-- rest expensive; the 7 day clearing window makes anything that slips through
-- reversible; and at nine ambassadors a person reading the first withdrawal
-- catches what all of it misses.
--
-- Nobody should read any single one of these as sufficient on its own.

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'circle cap is 4 per circle' as check,
       (public.circle_member_limit() = 4)::text as result
union all
select 'ambassador cannot vouch for their own referral',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_activation_sweep')
                 like '%other.user_id <> a.user_id%', false))::text
union all
select 'still no phone_confirmed_at dependency',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_activation_sweep')
                 not like '%phone_confirmed_at%', false))::text
union all
select 'device cap (the actual wall)', public.amb_max_per_device()::text
union all
select 'clearing window days', public.amb_clearing_days()::text;
