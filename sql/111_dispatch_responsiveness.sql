-- 111_dispatch_responsiveness.sql
-- ============================================================================
-- Stage 7: reach people who can actually go.
--
-- next_wave_helpers has always ordered candidates by `order by distance_m` and
-- nothing else. So the nearest person who has ignored every alert for a month
-- is alerted before somebody 400 metres further away who has come every single
-- time. Distance is a proxy for who can arrive. It says nothing about who will.
--
-- THE HISTORY DID NOT EXIST. The obvious fix is to rank on past behaviour, and
-- when I went looking for the data there was none: sos_responders records who
-- ACCEPTED, and nothing anywhere records who was asked. Without a denominator
-- there is no response rate, only a count of keen people. So this file records
-- the asking first and ranks second.
--
-- IT RECORDS ITSELF. The insert lives inside next_wave_helpers rather than in
-- the edge function that calls it, because the rows this function returns ARE
-- the dispatch, by definition. This project has shipped four things wired to
-- nothing while reporting green, and a log that a caller has to remember to
-- write is the fifth one waiting to happen.
--
-- HONEST ABOUT WHAT IT DOES TODAY: nothing. Every helper starts at the neutral
-- prior, so the order on day one is the order you already had. It only starts
-- to matter once real dispatches have accumulated, which is the point. A
-- ranking model with no data that changed the order anyway would be a random
-- number generator pointed at somebody's emergency.
--
-- Idempotent. Run after sql/110.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- WHO WAS ASKED
-- ---------------------------------------------------------------------------
-- Deliberately does NOT store whether they answered. That is derivable by
-- joining rescue_events, and a stored copy is a second source of truth that can
-- drift from the first. One fact, one place.
create table if not exists helper_dispatches (
  id        bigserial primary key,
  sos_id    uuid not null references sos_events(id) on delete cascade,
  helper_id uuid not null references auth.users(id) on delete cascade,
  at        timestamptz not null default now(),
  wave      int,
  -- One row per person per emergency. Being asked twice about the same SOS is
  -- still one chance to come, and counting it twice would punish somebody for
  -- being re-asked.
  unique (sos_id, helper_id)
);

create index if not exists helper_dispatches_helper_idx
  on helper_dispatches (helper_id, at desc);

alter table helper_dispatches enable row level security;
-- No policy at all, so no client can read or write it. Written only by the
-- SECURITY DEFINER function below. Who was asked to attend which emergency is
-- exactly the sort of thing that must never be queryable from a phone.
revoke all on helper_dispatches from anon, authenticated;

-- ---------------------------------------------------------------------------
-- WHO ACTUALLY COMES
-- ---------------------------------------------------------------------------
-- Accepted divided by asked, over a window, with a prior.
--
-- THE PRIOR IS THE WHOLE DESIGN. Ranking on a raw rate starves new helpers:
-- somebody with no history scores zero, is never alerted, never gets history,
-- and decays out of the network permanently while the model congratulates
-- itself. So an unknown helper is treated as AVERAGE, not as unproven. The
-- numbers 4 and 7 are chosen so a person with no record scores 0.571, which
-- maps to a multiplier of exactly 1.0 below: perfectly neutral, indistinguishable
-- from the ordering they would have had before this file existed.
--
-- Dispatches younger than 15 minutes are excluded. An SOS still running is not
-- an alert somebody ignored, and counting it as one would punish helpers for
-- emergencies that are in progress.
create or replace function public.helper_response_rate(p_days int default 90)
returns table (helper_id uuid, asked bigint, accepted bigint, rate numeric)
language sql
stable
security definer
set search_path = public
as $$
  select d.helper_id,
         count(*) as asked,
         count(*) filter (where exists (
           select 1 from rescue_events r
           where r.sos_id = d.sos_id and r.helper_id = d.helper_id)) as accepted,
         round(
           (count(*) filter (where exists (
              select 1 from rescue_events r
              where r.sos_id = d.sos_id and r.helper_id = d.helper_id)) + 4)::numeric
           / (count(*) + 7), 3) as rate
  from helper_dispatches d
  where d.at > now() - make_interval(days => greatest(p_days, 1))
    and d.at < now() - interval '15 minutes'
  group by d.helper_id;
$$;

revoke all on function public.helper_response_rate(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE RANKING
-- ---------------------------------------------------------------------------
-- Same candidates, same radius, same caps. Only the ORDER changes, and it
-- changes by at most 30 percent in either direction.
--
-- WHY A BOUNDED MULTIPLIER AND NOT A SCORE. An unbounded score lets
-- responsiveness overwhelm distance, and then a very reliable helper 8 km away
-- outranks an unreliable one across the street. Distance is the only term that
-- has anything to do with how fast somebody can physically arrive, so it stays
-- dominant and history is allowed to nudge it:
--
--     rate 1.0  (comes every time)   -> 0.7x, ranked as if 30 percent closer
--     rate 0.571 (no history at all) -> 1.0x, unchanged
--     rate 0.0  (never once came)    -> 1.4x, ranked as if 40 percent further
--
-- Nobody is ever EXCLUDED by their record. The radius filter still runs on true
-- distance, so a person who has ignored fifty alerts is still asked when they
-- are the only one there. Being unreliable is not a reason to be unreachable
-- when somebody has nobody else.
create or replace function public.next_wave_helpers(
  p_sos text, p_lat double precision, p_lng double precision, p_limit int default 3
)
returns table (user_id uuid, distance_m double precision)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sos uuid := public.orbii_uuid_or_null(p_sos);
begin
  return query
  with rates as (
    select * from public.helper_response_rate(90)
  ),
  picked as (
    select hl.user_id as uid,
           st_distance(hl.location, st_point(p_lng, p_lat)::geography) as dist,
           st_distance(hl.location, st_point(p_lng, p_lat)::geography)
             * greatest(0.7, least(1.4, 1.4 - 0.7 * coalesce(rr.rate, 0.571)))
             as effective
    from helpers_live hl
    left join rates rr on rr.helper_id = hl.user_id
    where hl.is_online
      and hl.updated_at > now() - interval '15 minutes'
      and hl.user_id <> (select e.user_id from sos_events e where e.id::text = p_sos)
      -- Anyone who has ever been on this SOS is excluded, including someone who
      -- accepted and left. Re-inviting a person who just said they could not come
      -- is noise to them and a false hope on the victim's screen.
      and not exists (select 1 from sos_responders r
                      where r.sos_id = p_sos and r.user_id = hl.user_id)
      -- Radius on TRUE distance, never on the adjusted one. A bad record must
      -- never push somebody outside the search area.
      and st_dwithin(hl.location, st_point(p_lng, p_lat)::geography, 3000)
    order by effective
    limit greatest(0, least(coalesce(p_limit, public.sos_wave_size()),
                            public.sos_free_slots(p_sos)))
  ),
  logged as (
    insert into helper_dispatches (sos_id, helper_id)
    select v_sos, p.uid from picked p
    where v_sos is not null
    on conflict (sos_id, helper_id) do nothing
    returning 1
  )
  -- TRUE distance is returned, not the adjusted one. The ranking is ours to
  -- reason about; the number shown to a helper and used downstream has to be
  -- the real one, or "800 m away" becomes a lie on somebody's screen.
  select p.uid, p.dist from picked p
  order by p.effective;
end $$;

revoke all on function public.next_wave_helpers(text, double precision, double precision, int)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- READ IT BACK
-- ---------------------------------------------------------------------------
-- Admin-gated and aggregate. Tells you whether the network is actually staffed
-- or just populated, which is the question behind stage 7.
create or replace function public.admin_helper_responsiveness(p_days int default 90)
returns table (
  helpers_asked      bigint,
  never_responded    bigint,
  always_responded   bigint,
  median_rate        numeric,
  dispatches_logged  bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with r as (select * from public.helper_response_rate(p_days) where public.is_admin())
  select count(*),
         count(*) filter (where accepted = 0),
         count(*) filter (where accepted = asked),
         round(percentile_cont(0.5) within group (order by rate)::numeric, 3),
         coalesce(sum(asked), 0)
  from r;
$$;

revoke all on function public.admin_helper_responsiveness(int) from public, anon;
grant execute on function public.admin_helper_responsiveness(int) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'dispatch log exists' as check,
       (to_regclass('public.helper_dispatches') is not null)::text as result
union all
select 'no client can read who was asked to attend an emergency (must be false)',
       has_table_privilege('authenticated', 'public.helper_dispatches', 'select')::text
union all
select 'no policy on the dispatch log either (must be 0)',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'helper_dispatches')
union all
select 'response rate function', (to_regprocedure('public.helper_response_rate(int)') is not null)::text
union all
select 'ranker still has its original signature',
       (to_regprocedure('public.next_wave_helpers(text,double precision,double precision,int)')
         is not null)::text
union all
-- If this is not plpgsql the rewrite did not take, and the ranking is still
-- distance-only while claiming otherwise.
select 'ranker was actually replaced (must be plpgsql)',
       (select l.lanname from pg_proc p join pg_language l on l.oid = p.prolang
         where p.proname = 'next_wave_helpers' limit 1)
union all
-- A helper with no history must rank EXACTLY where they used to. If this is not
-- 1.000 the prior is wrong and newcomers are being quietly buried.
select 'a helper with no history is neutral (must be 1.000)',
       round(greatest(0.7, least(1.4, 1.4 - 0.7 * 0.571)), 3)::text
union all
select 'admin readout', (to_regprocedure('public.admin_helper_responsiveness(int)') is not null)::text;
