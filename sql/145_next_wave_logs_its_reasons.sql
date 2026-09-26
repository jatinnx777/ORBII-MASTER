-- 145_next_wave_logs_its_reasons.sql
-- ============================================================================
-- next_wave_helpers writes down who it considered and why it skipped them.
--
-- sql/144 built dispatch_decisions and left it empty on purpose: filling it
-- means rewriting a live dispatch function, and that should not happen in the
-- same migration that creates the table it writes to. The table is applied and
-- verified, so this is the other half.
--
-- WHY IT IS WORTH THE RISK OF TOUCHING THIS FUNCTION. Four bugs were found in
-- this dispatcher in one week, and not one of them was visible from the code:
-- a client that stopped publishing when stationary, a release that never
-- reached the server, a wave selector on a fifteen minute window, an
-- acceptance row that outlived the helper's phone. Each was found by asking
-- the database what it actually contained. This makes the dispatcher answer
-- that question itself, the next time somebody asks why nobody came.
--
-- ============================================================================
-- HOW THIS AVOIDS CHANGING WHAT DISPATCH DOES
-- ============================================================================
--
-- The `picked` CTE below is COPIED VERBATIM from the live function, including
-- its ranking, its limit and its comments. Nothing is reordered, no filter is
-- rephrased, and the final SELECT is unchanged. A logging change that quietly
-- alters who gets dispatched would be worse than no logging at all.
--
-- Everything new sits in two additions that `picked` does not read:
--   * `considered`, which lists helpers in radius WITHOUT the online and
--     freshness filters, so the excluded ones can be named.
--   * one insert into dispatch_decisions.
--
-- IN RADIUS ONLY. Logging every helper in the country on every SOS would turn
-- a debugging aid into a record of where everybody was. Out-of-radius is
-- already knowable from the radius itself, so nothing is lost.
--
-- WAVE IS NULL. This function is not told which wave it is running, and
-- helper_dispatches does not set it either. Inventing a number here would be a
-- lie in a table whose whole purpose is to be trusted later.
--
-- Idempotent. No transaction control, nothing here can raise.
-- ============================================================================

create or replace function public.next_wave_helpers(
  p_sos text,
  p_lat double precision,
  p_lng double precision,
  p_limit integer default 3
)
returns table(user_id uuid, distance_m double precision)
language plpgsql
security definer
set search_path to 'public'
as $fn$
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
             * greatest(0.7, least(1.4, 1.4 - 0.7 * coalesce(rr.rate, 0.571))) as effective
    from helpers_live hl
    left join rates rr on rr.helper_id = hl.user_id
    where hl.is_online
      and hl.updated_at > now() - interval '4 minutes'
      and hl.user_id <> (select e.user_id from sos_events e where e.id::text = p_sos)
      -- Anyone who has ever been on this SOS is excluded, including someone who
      -- accepted and left. Re-inviting a person who just said they could not come
      -- is noise to them and a false hope on the victim's screen.
      and not exists (select 1 from sos_responders r where r.sos_id = p_sos and r.user_id = hl.user_id)
      -- Radius on TRUE distance, never on the adjusted one. A bad record must
      -- never push somebody outside the search area.
      and st_dwithin(hl.location, st_point(p_lng, p_lat)::geography, 3000)
    order by effective
    limit greatest(0, least(coalesce(p_limit, public.sos_wave_size()), public.sos_free_slots(p_sos)))
  ),
  logged as (
    insert into helper_dispatches (sos_id, helper_id)
    select v_sos, p.uid from picked p where v_sos is not null
    on conflict (sos_id, helper_id) do nothing
    returning 1
  ),
  -- ── NEW, AND READ BY NOTHING ABOVE ──────────────────────────────────────
  -- Everyone whose last known position is inside the radius, with the filters
  -- NOT applied, so the ones that were filtered out can say why.
  considered as (
    select hl.user_id as uid,
           hl.is_online,
           (hl.updated_at > now() - interval '4 minutes') as fresh,
           (hl.user_id = (select e.user_id from sos_events e where e.id::text = p_sos)) as is_self,
           exists (select 1 from sos_responders r
                    where r.sos_id = p_sos and r.user_id = hl.user_id) as already_on_it
    from helpers_live hl
    where st_dwithin(hl.location, st_point(p_lng, p_lat)::geography, 3000)
  ),
  decisions as (
    insert into dispatch_decisions (sos_id, wave, helper_id, decision, reason)
    select
      v_sos,
      null::int,
      c.uid,
      case
        when exists (select 1 from picked p where p.uid = c.uid) then 'dispatched'
        when c.is_self                                          then 'excluded_self'
        when c.already_on_it                                    then 'excluded_already_dispatched'
        when not c.is_online                                    then 'excluded_off_duty'
        when not c.fresh                                        then 'excluded_stale'
        -- In radius, online, fresh, not self, not already on it, and still not
        -- chosen: the wave was full or the slot count was zero. That is the
        -- case somebody will most want explained.
        else 'excluded_other'
      end,
      case
        when exists (select 1 from picked p where p.uid = c.uid) then null
        when c.is_self                       then 'the person who raised the SOS'
        when c.already_on_it                 then 'already dispatched to this SOS, or accepted and left'
        when not c.is_online                 then 'off duty'
        when not c.fresh                     then 'no position in the last 4 minutes'
        else 'eligible, but the wave had no free slot'
      end
    from considered c
    where v_sos is not null
    returning 1
  )
  -- TRUE distance is returned, not the adjusted one. The ranking is ours to
  -- reason about; the number shown to a helper and used downstream has to be
  -- the real one, or "800 m away" becomes a lie on somebody's screen.
  select p.uid, p.dist from picked p order by p.effective;
end
$fn$;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- What this can and cannot prove. It can confirm the function still exists
-- with the right shape, security and window, and that it now references the
-- decisions table. It CANNOT prove the dispatch result is unchanged, because
-- that needs a real SOS with real helpers in radius, and there are none right
-- now. That is a real-world test, not a SQL one.
-- ---------------------------------------------------------------------------
select 'next_wave_helpers still exists' as check,
       (to_regprocedure('public.next_wave_helpers(text,double precision,double precision,integer)')
          is not null)::text as result

union all
select 'still SECURITY DEFINER (must be true)',
       (select prosecdef::text from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'still on the 4-minute window',
       (select (regexp_match(regexp_replace(pg_get_functiondef(oid), '\s+', ' ', 'g'),
                             'interval ''([0-9]+ [a-z]+)'''))[1]
          from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'it now records its decisions (must be true)',
       (select (pg_get_functiondef(oid) like '%dispatch_decisions%')::text
          from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'it still writes helper_dispatches (must be true)',
       (select (pg_get_functiondef(oid) like '%helper_dispatches%')::text
          from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'it still returns TRUE distance, not the adjusted one (must be true)',
       (select (pg_get_functiondef(oid) like '%select p.uid, p.dist from picked p order by p.effective%')::text
          from pg_proc
         where proname = 'next_wave_helpers' and pronamespace = 'public'::regnamespace)

union all
select 'decisions written so far',
       (select count(*)::text from dispatch_decisions);
