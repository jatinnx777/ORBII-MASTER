-- 115_seven_day_trail.sql
-- ============================================================================
-- Location history moves from "wiped at midnight" to "kept for 7 days".
--
-- WHY THIS IS A REAL DECISION AND NOT A CONSTANT. The midnight wipe was a
-- published promise, stated 31 times across the privacy policy, the security
-- page, the about page and eight blog posts, one of which had it in the URL.
-- Changing the number here without changing those makes every one of them
-- false, and a privacy policy that misstates retention is not a copy problem.
--
-- Those are being rewritten in the same change. If you are reading this and the
-- site still says midnight anywhere, that is a bug, not a stale doc.
--
-- WHAT IS GAINED. Trip replay could only ever show today, which for anyone
-- checking on a journey that ended after midnight was useless. A week of trail
-- makes the feature answer "
--how did the last few days go" instead of "how has
-- the last few hours gone".
--
-- WHAT IS LOST, and it should be said plainly. A day of location data on a
-- server is a much smaller thing to lose than a week of it. The wipe was the
-- strongest privacy claim in the product and it is now a weaker one. It is
-- still far stronger than the trackers ORBII is compared against, most of which
-- keep 30 days or more, but it is weaker than it was.
--
-- The 500 row cap stays. Seven days of fixes at one a minute would be ten
-- thousand points, and neither the replay nor the map has any use for that.
--
-- Idempotent. Run after sql/114.
-- ============================================================================

-- One number, one place. Every retention decision below reads this, so the
-- window can never drift between the job that deletes and the query that reads.
create or replace function public.orbii_trail_days()
returns int language sql immutable as $$ select 7 $$;

-- ---------------------------------------------------------------------------
-- THE JOB
-- ---------------------------------------------------------------------------
select cron.unschedule('orbii-midnight-location-wipe')
  where exists (select 1 from cron.job where jobname = 'orbii-midnight-location-wipe');

select cron.unschedule('orbii-prune-location-history')
  where exists (select 1 from cron.job where jobname = 'orbii-prune-location-history');

-- Still at 18:30 UTC, which is midnight IST. Running it at the same hour keeps
-- the deletion predictable for anyone who was told "overnight", it just now
-- deletes the eighth day rather than yesterday.
select cron.schedule(
  'orbii-trail-prune',
  '30 18 * * *',
  $$ delete from circle_location_history
       where at < now() - make_interval(days => public.orbii_trail_days()); $$
);

-- ---------------------------------------------------------------------------
-- THE READ
-- ---------------------------------------------------------------------------
-- The midnight clamp is gone, but the belt-and-braces principle behind it is
-- not: pg_cron can be paused and a free-tier project can sleep, so a missed run
-- must never surface data older than the promise. The read enforces the same
-- window the job does, from the same function.
create or replace function public.circle_member_trail(p_uid uuid, p_hours int default 168)
returns table (lat double precision, lng double precision, at timestamptz)
language sql security definer set search_path = public as $$
  select h.lat, h.lng, h.at
  from circle_location_history h
  where h.user_id = p_uid
    and (h.user_id = auth.uid() or public.shares_circle_with(p_uid))
    -- Whichever is tighter: what the caller asked for, or the retention
    -- promise. A caller asking for 30 days gets 7, and cannot get more by
    -- asking louder.
    and h.at > now() - make_interval(hours => least(p_hours, public.orbii_trail_days() * 24))
  order by h.at desc
  limit 500;
$$;

-- ANON COULD CALL THIS, and had been able to since sql/73.
--
-- `create or replace function` preserves whatever grants the function already
-- had, and Postgres grants EXECUTE to PUBLIC by default, which anon inherits.
-- sql/73 granted to authenticated and never revoked from public, so the grant
-- to authenticated was decorative: everyone already had it.
--
-- Nothing leaked. The function is SECURITY DEFINER and every row is gated on
-- auth.uid(), which is null for anon, so the predicate matches nothing. But
-- that means one layer was doing all the work, and this is the second time in
-- this codebase that a revoke was assumed rather than written (see sql/110 and
-- app_events). Assume it is missing everywhere until a verify line says
-- otherwise.
revoke all on function public.circle_member_trail(uuid, int) from public, anon;
grant execute on function public.circle_member_trail(uuid, int) to authenticated;

-- Same treatment for the helper introduced above, before it acquires the same
-- problem by default.
revoke all on function public.orbii_trail_days() from public, anon;
grant execute on function public.orbii_trail_days() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'retention window (must be 7)' as check,
       public.orbii_trail_days()::text as result
union all
select 'prune job is scheduled',
       (exists (select 1 from cron.job where jobname = 'orbii-trail-prune'))::text
union all
select 'the old midnight job is gone (must be false)',
       (exists (select 1 from cron.job where jobname = 'orbii-midnight-location-wipe'))::text
union all
select 'trail rpc still exists',
       (to_regprocedure('public.circle_member_trail(uuid,int)') is not null)::text
union all
-- A caller asking for a year must still be capped at the promise. If this is
-- not 168 the read can outlive the deletion and the policy becomes a lie.
select 'a caller cannot ask past the window (must be 168)',
       least(8760, public.orbii_trail_days() * 24)::text
union all
select 'anon cannot read trails (must be false)',
       has_function_privilege('anon', 'public.circle_member_trail(uuid,int)', 'execute')::text;

-- ---------------------------------------------------------------------------
-- AND THE SAME QUESTION FOR EVERYTHING ELSE
-- ---------------------------------------------------------------------------
-- The trail grant was wrong because a revoke was assumed rather than written.
-- That assumption was not made once. This lists every SECURITY DEFINER function
-- in public that anon can currently execute, which is the set to review.
--
-- Not all of these are bugs: some are deliberately reachable before sign-in.
-- But each one should be a decision somebody made, and right now they are
-- whatever Postgres defaulted to.
select p.proname as function_anon_can_execute,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef                                    -- SECURITY DEFINER only
  and has_function_privilege('anon', p.oid, 'execute')
order by 1;
