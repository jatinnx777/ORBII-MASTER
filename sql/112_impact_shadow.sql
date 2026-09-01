-- 112_impact_shadow.sql
-- ============================================================================
-- Reading back what impact detection WOULD have done.
--
-- volumetricShock.ts has been switched off since it was written, for an honest
-- reason: every threshold in it was reasoned from published fall-detection
-- ranges and not one was measured on a phone ORBII ships to. IMPACT_G is 3.8
-- because papers say a fall from waist height lands between 4 and 10 g. Nobody
-- has ever checked what a Redmi in a kurta pocket reads when its owner jogs for
-- a bus.
--
-- You cannot fix that by reasoning harder, and shipping it to find out would
-- mean finding out on somebody's real evening. So the detector now runs for
-- real with its only route into the app closed, and logs every decision it
-- reaches, including each rejection and the reason for it.
--
-- WHAT TO LOOK FOR after a week of real use:
--
--   unresponsive   would have opened a countdown. If this is more than a
--                  handful per user per week, IMPACT_G is too low and turning
--                  the feature on would cry wolf.
--   impact         crossed the g threshold. The gap between this and
--                  'unresponsive' is the guards doing their job.
--   rejected       no_motion_before_impact is the desk-drop filter. If it
--                  dominates, the filter is earning its place.
--   aborted        movement resumed. Somebody got back up, which is the good
--                  outcome and should be common.
--
-- Idempotent. Run after sql/111.
-- ============================================================================

create or replace function public.admin_impact_shadow(p_days int default 14)
returns table (
  outcome      text,
  reason       text,
  n            bigint,
  devices      bigint,
  median_g     numeric,
  max_g        numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.params->>'type' as outcome,
    coalesce(e.params->>'reason', '') as reason,
    count(*) as n,
    -- Per person, because one phone in a gym bag can produce a hundred impacts
    -- and make a rare event look common.
    count(distinct e.user_id) as devices,
    round(percentile_cont(0.5) within group (
      order by nullif(e.params->>'magnitudeG', '')::numeric)::numeric, 2) as median_g,
    round(max(nullif(e.params->>'magnitudeG', '')::numeric), 2) as max_g
  from app_events e
  where public.is_admin()
    and e.name = 'impact_shadow'
    and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  group by 1, 2
  order by n desc;
$$;

revoke all on function public.admin_impact_shadow(int) from public, anon;
grant execute on function public.admin_impact_shadow(int) to authenticated;

-- ---------------------------------------------------------------------------
-- THE ONE NUMBER THAT DECIDES IT
-- ---------------------------------------------------------------------------
-- How many countdowns per person per week this feature would have opened.
--
-- A countdown is cancellable, so a false one is not a false SOS. But it wakes
-- her phone, it demands attention, and at some rate she switches the feature
-- off and it protects her never. That rate, not the detector's cleverness, is
-- what decides whether this ships.
--
-- Under roughly 0.5 per person per week is worth turning on. Above 2, the
-- thresholds are wrong and turning it on would be a mistake.
create or replace function public.admin_impact_would_fire(p_days int default 14)
returns table (
  people             bigint,
  would_have_fired   bigint,
  per_person_per_week numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with seen as (
    select e.user_id,
           count(*) filter (where e.params->>'type' = 'unresponsive') as fired
    from app_events e
    where public.is_admin()
      and e.name = 'impact_shadow'
      and e.created_at > now() - make_interval(days => greatest(p_days, 1))
      and e.user_id is not null
    group by e.user_id
  )
  select count(*),
         coalesce(sum(fired), 0),
         -- Guarded so a one-day window does not report a fortnight's rate.
         round(coalesce(sum(fired), 0)::numeric
               / nullif(count(*), 0)
               / (greatest(p_days, 1)::numeric / 7), 3)
  from seen;
$$;

revoke all on function public.admin_impact_would_fire(int) from public, anon;
grant execute on function public.admin_impact_would_fire(int) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'shadow breakdown rpc' as check,
       (to_regprocedure('public.admin_impact_shadow(int)') is not null)::text as result
union all
select 'the go or no-go rpc',
       (to_regprocedure('public.admin_impact_would_fire(int)') is not null)::text
union all
select 'app_events is still write-only for clients (must be false)',
       has_table_privilege('authenticated', 'public.app_events', 'select')::text
union all
-- Not an admin in the SQL editor, so this is a live test of the gate.
select 'admin gate holds: people must be 0 from the SQL editor',
       (select people from public.admin_impact_would_fire(14))::text;

-- ---------------------------------------------------------------------------
-- After a week:
--
--   select * from admin_impact_would_fire(14);
--   select * from admin_impact_shadow(14);
--
-- Then set IMPACT_G, PRE_IMPACT_MOTION_G and STILLNESS_TOLERANCE_G in
-- src/services/volumetricShock.ts from those numbers, and only then consider
-- flipping ENABLE_IMPACT_DETECTION.
-- ---------------------------------------------------------------------------
