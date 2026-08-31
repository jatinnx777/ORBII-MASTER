-- 110_pipeline_metrics.sql
-- ============================================================================
-- The numbers. Not a feature, and more important than one.
--
-- Every safety app in India can send an alert. None of them will tell you what
-- happened next, because none of them measure it. ORBII already writes every
-- fact needed to answer that question and has never been able to read any of it
-- back: app_events is insert-only by design, and the rescue timings sit in four
-- different tables nobody joins.
--
-- Nothing here writes anything. Every function is a read over rows that already
-- exist, so there is no new logging, no new storage, and no new privacy
-- surface. It is aggregate-only and admin-gated twice over, because "show me
-- how the rescues went" must never become a way to read who was rescued.
--
-- WHAT EACH ONE IS FOR:
--
--   admin_voice_accuracy   the false-positive rate of Voice SOS, per phrase.
--                          Cancelled / (cancelled + confirmed). This is the
--                          number the whole voice engine gets judged on.
--   admin_window_effect    whether the adaptive countdown actually works.
--                          If 'high' confidence triggers get cancelled as often
--                          as 'low' ones, the classifier is wrong and its
--                          thresholds move. This is how it gets disproved.
--   admin_pipeline_funnel  of real SOS raised, how many reached each stage.
--                          The last column is the one that matters: help
--                          confirmed on scene.
--   admin_pipeline_timings how long each stage took, median and p90.
--
-- Idempotent. Run after sql/109.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- FIRST, CLOSE A GRANT THAT SHOULD NEVER HAVE BEEN THERE
-- ---------------------------------------------------------------------------
-- sql/35 says app_events is write-only from the app and gives it an insert
-- policy and no select policy. That is true at the row level and it is where
-- the protection actually comes from, but the TABLE privilege was never
-- revoked: Supabase ships `grant all on all tables in schema public to anon,
-- authenticated`, so select has been granted this whole time.
--
-- Nothing leaks today. RLS is on, there is no select policy, so a client asking
-- for rows gets none. But that means one layer is doing all the work, and the
-- day somebody adds a permissive policy for an unrelated reason, the entire
-- event stream becomes readable by anyone holding the key shipped inside the
-- APK. Two layers cost nothing here, because no client has ever read this table
-- and none is meant to.
revoke select, update, delete on app_events from anon, authenticated;
-- Insert stays, minus anon, which sql/37 already removed.
grant insert on app_events to authenticated;

-- ---------------------------------------------------------------------------
-- VOICE SOS FALSE-POSITIVE RATE
-- ---------------------------------------------------------------------------
-- A voice trigger she lets run to zero is a real detection. One she cancels
-- inside the countdown is a false alarm. That ratio is the engine's error rate
-- and it has been sitting unread in app_events since sql/35.
--
-- Grouped by phrase, because the fix is almost never "the model is bad", it is
-- "one word misfires". If 'help' cancels at 40 percent and 'bachao' at 4, the
-- answer is not retraining, it is that 'help' appears in ordinary speech and
-- 'bachao' does not.
create or replace function public.admin_voice_accuracy(p_days int default 30)
returns table (
  phrase        text,
  confirmed     bigint,
  cancelled     bigint,
  total         bigint,
  cancel_pct    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(e.params->>'phrase', 'unknown') as phrase,
    count(*) filter (where e.name = 'voice_sos_confirmed') as confirmed,
    count(*) filter (where e.name = 'voice_sos_cancelled') as cancelled,
    count(*) as total,
    round(100.0 * count(*) filter (where e.name = 'voice_sos_cancelled')
          / nullif(count(*), 0), 1) as cancel_pct
  from app_events e
  where public.is_admin()
    and e.name in ('voice_sos_confirmed', 'voice_sos_cancelled')
    and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  group by 1
  order by cancelled desc, total desc;
$$;

revoke all on function public.admin_voice_accuracy(int) from public, anon;
grant execute on function public.admin_voice_accuracy(int) to authenticated;

-- ---------------------------------------------------------------------------
-- DOES THE ADAPTIVE COUNTDOWN ACTUALLY WORK
-- ---------------------------------------------------------------------------
-- src/services/sos-confidence.ts lengthens the window when the phone has not
-- moved and shortens it when the phone is being fought over. That is a claim,
-- and a claim on a safety path has to be falsifiable.
--
-- If it works, 'low' confidence triggers cancel far more often than 'high' ones,
-- because that is exactly what low confidence is asserting. If the three rows
-- come back with similar cancel rates, the classifier is reading noise and the
-- thresholds are wrong. Read this before believing the feature.
create or replace function public.admin_window_effect(p_days int default 30)
returns table (
  confidence  text,
  window_sec  text,
  confirmed   bigint,
  cancelled   bigint,
  cancel_pct  numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(e.params->>'confidence', 'normal') as confidence,
    coalesce(e.params->>'window', '5') as window_sec,
    count(*) filter (where e.name = 'voice_sos_confirmed') as confirmed,
    count(*) filter (where e.name = 'voice_sos_cancelled') as cancelled,
    round(100.0 * count(*) filter (where e.name = 'voice_sos_cancelled')
          / nullif(count(*), 0), 1) as cancel_pct
  from app_events e
  where public.is_admin()
    and e.name in ('voice_sos_confirmed', 'voice_sos_cancelled')
    and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.admin_window_effect(int) from public, anon;
grant execute on function public.admin_window_effect(int) to authenticated;

-- ---------------------------------------------------------------------------
-- THE FUNNEL
-- ---------------------------------------------------------------------------
-- Of the real SOS raised, how many got as far as each stage.
--
-- "Sent" is not "help is coming", and this is the table that proves which one
-- ORBII is delivering. The honest reading is the rightmost column: an SOS where
-- somebody was confirmed on scene by geofence, not by tapping a button.
--
-- Test SOS are excluded. Counting practice runs as rescues would make the
-- number that matters most the easiest one to fake.
create or replace function public.admin_pipeline_funnel(p_days int default 30)
returns table (
  raised            bigint,
  reached_helper    bigint,
  someone_accepted  bigint,
  escalation_taken  bigint,
  arrived_on_scene  bigint,
  resolved          bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with sos as (
    select e.id, e.created_at, e.resolved_at
    from sos_events e
    where public.is_admin()
      and e.kind = 'real'
      and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  )
  select
    count(*) as raised,
    -- Reached at least one responder's phone (they were dispatched to).
    count(*) filter (where exists (
      select 1 from sos_responders r where r.sos_id = s.id::text)) as reached_helper,
    -- Somebody actually accepted.
    count(*) filter (where exists (
      select 1 from rescue_events r where r.sos_id = s.id)) as someone_accepted,
    -- Somebody took responsibility for calling 112 or going there (sql/109).
    count(*) filter (where exists (
      select 1 from sos_escalations x
      where x.sos_id = s.id and x.released_at is null)) as escalation_taken,
    -- Confirmed on scene. arrived_at is set by geofence only, never a tap.
    count(*) filter (where exists (
      select 1 from rescue_events r
      where r.sos_id = s.id and r.arrived_at is not null)) as arrived_on_scene,
    count(*) filter (where s.resolved_at is not null) as resolved
  from sos s;
$$;

revoke all on function public.admin_pipeline_funnel(int) from public, anon;
grant execute on function public.admin_pipeline_funnel(int) to authenticated;

-- ---------------------------------------------------------------------------
-- HOW LONG EACH STAGE TOOK
-- ---------------------------------------------------------------------------
-- Median AND p90, never the mean. One SOS resolved three days later because
-- nobody closed the screen would drag a mean into uselessness, and p90 is the
-- honest half of the pair: the median says how it usually goes, p90 says how it
-- goes when it goes badly, and only the second one is worth fixing.
--
-- `n` is on every row on purpose. A three second median over four samples is
-- not a fact, and a metric that hides its sample size invites believing it.
create or replace function public.admin_pipeline_timings(p_days int default 30)
returns table (
  stage      text,
  n          bigint,
  median_sec numeric,
  p90_sec    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with sos as (
    select e.id, e.created_at, e.resolved_at
    from sos_events e
    where public.is_admin()
      and e.kind = 'real'
      and e.created_at > now() - make_interval(days => greatest(p_days, 1))
  ),
  spans as (
    select 'sos to first accept' as stage,
           extract(epoch from (min(r.accepted_at) - s.created_at)) as secs
    from sos s join rescue_events r on r.sos_id = s.id
    group by s.id, s.created_at

    union all
    select 'sos to someone owning 112',
           extract(epoch from (min(x.at) - s.created_at))
    from sos s join sos_escalations x
      on x.sos_id = s.id and x.action = 'calling_112'
    group by s.id, s.created_at

    union all
    select 'sos to first arrival',
           extract(epoch from (min(r.arrived_at) - s.created_at))
    from sos s join rescue_events r
      on r.sos_id = s.id and r.arrived_at is not null
    group by s.id, s.created_at

    union all
    select 'sos to resolved',
           extract(epoch from (s.resolved_at - s.created_at))
    from sos s
    where s.resolved_at is not null
  )
  select stage,
         count(*) as n,
         round(percentile_cont(0.5) within group (order by secs)::numeric, 1),
         round(percentile_cont(0.9) within group (order by secs)::numeric, 1)
  from spans
  -- A negative span means clock skew between a phone and the server, not a
  -- rescue that finished before it started. Dropped rather than averaged in.
  where secs >= 0
  group by stage
  order by stage;
$$;

revoke all on function public.admin_pipeline_timings(int) from public, anon;
grant execute on function public.admin_pipeline_timings(int) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'voice accuracy rpc' as check,
       (to_regprocedure('public.admin_voice_accuracy(int)') is not null)::text as result
union all
select 'window effect rpc (this is what falsifies the classifier)',
       (to_regprocedure('public.admin_window_effect(int)') is not null)::text
union all
select 'funnel rpc', (to_regprocedure('public.admin_pipeline_funnel(int)') is not null)::text
union all
select 'timings rpc', (to_regprocedure('public.admin_pipeline_timings(int)') is not null)::text
union all
-- TWO CHECKS, NOT ONE. The first version of this asked only for the privilege
-- and came back true, which read as a leak and was not one: sql/93 already
-- recorded that Supabase grants broadly and RLS is what filters rows. Asking
-- about the grant alone tests the wrong layer, in both directions. So ask about
-- both, and the row filter first, because that is the one that protects data.
select 'no select POLICY on app_events, so no rows are readable (must be 0)',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'app_events'
           and cmd in ('SELECT', 'ALL'))
union all
select 'select privilege now revoked too, second layer (must be false)',
       has_table_privilege('authenticated', 'public.app_events', 'select')::text
union all
select 'the app can still WRITE events (must be true, or metrics go blank)',
       has_table_privilege('authenticated', 'public.app_events', 'insert')::text
union all
-- The SQL editor has no auth.uid(), so is_admin() is false here and this call
-- is a live test of the gate rather than a lookup. If it comes back non-zero,
-- the funnel is leaking rescue counts to anyone who can call it.
select 'admin gate holds: raised must be 0 when run from the SQL editor',
       (select raised from public.admin_pipeline_funnel(30))::text;

-- ---------------------------------------------------------------------------
-- Once events start flowing, these are the four calls:
--
--   select * from admin_pipeline_funnel(30);
--   select * from admin_pipeline_timings(30);
--   select * from admin_voice_accuracy(30);
--   select * from admin_window_effect(30);
-- ---------------------------------------------------------------------------
