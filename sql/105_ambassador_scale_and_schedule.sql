-- 105_ambassador_scale_and_schedule.sql
-- ============================================================================
-- THE SWEEP WAS NEVER SCHEDULED. Nothing has ever activated.
--
-- ambassador_activation_sweep() is defined in sql/97, redefined in sql/100 and
-- redefined again in sql/101. It is called by nothing. There is no cron job, no
-- edge function, and no client path, and execute is revoked from authenticated
-- so no client could call it even if one tried.
--
-- Every gate we built works. None of them ever runs. The consequence is not
-- subtle: no referral activates, no ledger row is written, nothing clears,
-- every dashboard reads zero forever, and no payout is possible. Nine
-- ambassadors would have found this within a week. Forty will find it in a day.
--
-- This is also the likely reason the earlier diagnostic reported eight users
-- qualifying while the pass counters stayed at zero. The qualification query
-- and the sweep were two different things, and only one of them was a query.
--
-- This file does three things:
--   1. Schedules the sweep, hourly.
--   2. Gives an admin a way to run it by hand, for testing and for the day
--      pg_cron is asleep.
--   3. Adds batch ambassador creation, because 40 form submissions is 40
--      chances to typo a code.
--
-- Plus one diagnostic, because with 40 ambassadors "why does my count say 0"
-- becomes the support load, and answering it by hand does not scale.
--
-- Idempotent. Run after sql/104.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. SCHEDULE IT
-- ---------------------------------------------------------------------------
-- Hourly. Activation already requires the referral to be 24 hours old, so the
-- sweep frequency does not change who qualifies, only how soon a dashboard
-- catches up. An hour is fast enough that an ambassador running a session on
-- Monday sees the number move on Tuesday, and slow enough to cost nothing.
--
-- Minute 13 to stay clear of the other jobs in this database, which sit on 17,
-- 23 and 41.
--
-- FREE TIER WARNING. A paused Supabase project runs no cron. If the project
-- sleeps, activations do not vanish, they queue: the next run picks up
-- everything that became eligible while it was down, because every condition is
-- evaluated against the current state rather than against a window. Check the
-- job actually ran before telling an ambassador their number is correct.
select cron.unschedule('orbii-ambassador-sweep')
  where exists (select 1 from cron.job where jobname = 'orbii-ambassador-sweep');

select cron.schedule(
  'orbii-ambassador-sweep',
  '13 * * * *',
  $$ select public.ambassador_activation_sweep(); $$
);

-- ---------------------------------------------------------------------------
-- 2. RUN IT BY HAND
-- ---------------------------------------------------------------------------
-- Needed for two real situations. Testing the whole loop without waiting an
-- hour, and the morning pg_cron did not fire and somebody is asking why.
--
-- The sweep itself stays revoked from authenticated. This wrapper is the only
-- way in and it is gated on is_admin() as its first statement, the same shape
-- sql/103 uses, for the same reason sql/102 had to be written twice.
create or replace function public.admin_run_activation_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  select * into r from public.ambassador_activation_sweep();

  return jsonb_build_object(
    'ok', true,
    'activated', coalesce(r.activated, 0),
    'credited',  coalesce(r.credited, 0),
    'bonuses',   coalesce(r.bonuses, 0),
    'cleared',   coalesce(r.cleared, 0),
    'message', format('Activated %s, credited %s, bonuses %s, cleared %s.',
                      coalesce(r.activated, 0), coalesce(r.credited, 0),
                      coalesce(r.bonuses, 0), coalesce(r.cleared, 0))
  );
end $$;

revoke all on function public.admin_run_activation_sweep() from public, anon;
grant execute on function public.admin_run_activation_sweep() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. BATCH CREATION
-- ---------------------------------------------------------------------------
-- Takes a jsonb array of {email, code, college} and adds them one at a time,
-- reporting per row.
--
-- It calls admin_add_ambassador rather than reimplementing the checks. Two
-- copies of a validation rule is two places to forget, which is exactly the
-- mistake sql/104 had to undo when the admin helper carried its own regex.
--
-- PARTIAL SUCCESS IS THE POINT. One bad email in a list of forty must not
-- reject the other thirty-nine. Each row is independent and the result says
-- which ones landed, so the operator fixes two lines instead of re-entering
-- forty. Deliberately not one transaction.
create or replace function public.admin_add_ambassadors_batch(
  p_rows jsonb,
  p_term text default '2026-autumn'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_in  jsonb;
  one     jsonb;
  results jsonb := '[]'::jsonb;
  n_ok    int := 0;
  n_fail  int := 0;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    return jsonb_build_object('ok', false, 'message', 'Expected a list of rows.');
  end if;

  -- A guard rail, not a policy. Forty is the planned cohort; a hundred is a
  -- paste that went wrong.
  if jsonb_array_length(p_rows) > 100 then
    return jsonb_build_object('ok', false,
      'message', 'That is more than 100 rows. Split it, or check the paste.');
  end if;

  for row_in in select * from jsonb_array_elements(p_rows)
  loop
    one := public.admin_add_ambassador(
      row_in->>'email',
      row_in->>'code',
      coalesce(row_in->>'college', ''),
      p_term
    );

    if (one->>'ok')::boolean then
      n_ok := n_ok + 1;
    else
      n_fail := n_fail + 1;
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'email',   row_in->>'email',
      'code',    upper(btrim(coalesce(row_in->>'code', ''))),
      'ok',      (one->>'ok')::boolean,
      'message', one->>'message'
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'added', n_ok,
    'failed', n_fail,
    'rows', results,
    'message', format('%s added, %s failed.', n_ok, n_fail)
  );
end $$;

revoke all on function public.admin_add_ambassadors_batch(jsonb, text) from public, anon;
grant execute on function public.admin_add_ambassadors_batch(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. WHY IS MY COUNT ZERO
-- ---------------------------------------------------------------------------
-- With forty ambassadors this question arrives forty times, and the honest
-- answer is almost always the circle condition from sql/101, which is the
-- strictest gate and the least obvious one.
--
-- Counts referrals that are old enough to have activated and have not, grouped
-- by the first gate each one fails. Aggregate only. No emails, no user ids, and
-- admin gated regardless.
--
-- If the largest bucket is no_circle_member week after week, the fix is pushing
-- circle setup harder during onboarding, not relaxing the rule. Relaxing it
-- reopens the farm sql/101 exists to close.
create or replace function public.admin_referral_blockers()
returns table (blocker text, referrals int)
language sql
stable
security definer
set search_path = public
as $$
  with stuck as (
    select
      r.id,
      case
        when r.rejected_at is not null then 'rejected'
        when r.held_at is not null      then 'held_device_cap'
        when r.referred_user is null    then 'no_account_bound'
        when not public.amb_identity_verified(r.referred_user)
                                        then 'email_not_verified'
        when not exists (select 1 from emergency_contacts ec
                         where ec.user_id = r.referred_user)
                                        then 'no_emergency_contact'
        when not exists (
          select 1 from circle_members m
          join circle_members other
            on other.circle_id = m.circle_id
           and other.user_id <> m.user_id
           and other.deleted_at is null
           and other.user_id <> a.user_id
          where m.user_id = r.referred_user and m.deleted_at is null
        )                               then 'no_circle_member'
        else 'should_activate_next_sweep'
      end as blocker
    from ambassador_referrals r
    join ambassadors a on a.id = r.ambassador_id
    where r.activated_at is null
      and r.created_at < now() - interval '24 hours'
      and public.is_admin()
  )
  select blocker, count(*)::int from stuck group by blocker order by count(*) desc;
$$;

revoke all on function public.admin_referral_blockers() from public, anon;
grant execute on function public.admin_referral_blockers() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- The first row is the one that matters. Everything else in the ambassador
-- programme was already correct and inert.
select 'sweep is scheduled (THE fix, must be true)' as check,
       (exists (select 1 from cron.job where jobname = 'orbii-ambassador-sweep'))::text as result
union all
select 'sweep schedule',
       coalesce((select schedule from cron.job where jobname = 'orbii-ambassador-sweep'), 'NOT SCHEDULED')
union all
select 'manual sweep rpc',
       (to_regprocedure('public.admin_run_activation_sweep()') is not null)::text
union all
select 'batch add rpc',
       (to_regprocedure('public.admin_add_ambassadors_batch(jsonb,text)') is not null)::text
union all
select 'blocker diagnostic rpc',
       (to_regprocedure('public.admin_referral_blockers()') is not null)::text
union all
-- Regression guard. sql/101 must still be the live definition of the sweep. If
-- sql/100 is ever re-run after sql/101 this goes false and one ambassador
-- account can vouch for every referral it created.
select 'sweep still has the sql/101 circle fix (must be true)',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_activation_sweep')
                 like '%other.user_id <> a.user_id%', false))::text
union all
select 'device cap still 3',
       coalesce((select public.amb_max_per_device()::text), 'MISSING')
union all
select 'clearing days still 7',
       coalesce((select public.amb_clearing_days()::text), 'MISSING')
union all
select 'circle requirement still on',
       coalesce((select public.amb_require_circle_member()::text), 'MISSING')
union all
select 'ambassadors on the books',
       (select count(*)::text from ambassadors where status = 'active');
