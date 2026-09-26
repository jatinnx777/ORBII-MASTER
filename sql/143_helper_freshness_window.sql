-- 143_helper_freshness_window.sql
-- ============================================================================
-- A helper is dispatchable for four minutes after their last position, not ten.
--
-- THE MISMATCH. The Helper app calls a helper stale after 90 seconds: it
-- publishes once a minute, so a 90 second gap is the task being gone rather
-- than jitter. The server disagreed by a factor of six and kept dispatching
-- anybody seen in the last ten minutes.
--
-- WHY THAT COSTS A RESCUE. Dispatch goes out in waves of three, and wave two
-- does not leave for four minutes (sql/78). A helper whose phone died five
-- minutes ago still fills one of the three slots in wave one, and holds it for
-- the entire four minutes before anyone else is asked. One dead session can
-- take a third of the first wave; three take all of it, and the woman waiting
-- sees "3 helpers notified" while nobody has been.
--
-- WHY FOUR MINUTES AND NOT NINETY SECONDS. The client's 90 seconds is the right
-- number for the client, which knows its own publish cadence. The server is
-- reading rows written across a mobile network, and a single retried write in
-- a lift would drop a live helper out of the pool. Four minutes is four missed
-- publishes in a row, which is no longer jitter, and it still expires a dead
-- session inside one dispatch wave rather than after two and a half.
--
-- MEASURED BEFORE CHANGING, on 26 September 2026: helpers_live held 2 rows,
-- both is_online, and ZERO fresh within either ten minutes or four. Both were
-- already dead sessions the old window would still have dispatched to. So this
-- excludes nobody who is currently reachable.
--
-- THE THREE FUNCTIONS MOVE TOGETHER. check_helper_network_availability is what
-- the main app asks before promising a woman that helpers exist nearby. If it
-- kept the looser window it would answer yes on the strength of helpers
-- dispatch would then refuse to contact, which is a worse lie than saying no.
--
-- Rewrites only the interval in each body, so nothing else about these
-- functions can drift. Idempotent.
-- ============================================================================

do $$
declare
  r      record;
  v_src  text;
  v_new  text;
  n      int := 0;
begin
  for r in
    select oid, proname
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'dispatch_verified_helpers',
        'dispatch_community_helpers',
        'check_helper_network_availability'
      )
  loop
    v_src := pg_get_functiondef(r.oid);
    v_new := replace(v_src, 'interval ''10 minutes''', 'interval ''4 minutes''');
    if v_new <> v_src then
      execute v_new;
      n := n + 1;
      raise notice 'tightened %', r.proname;
    else
      raise notice 'no 10-minute window found in %, left alone', r.proname;
    end if;
  end loop;
  raise notice 'functions updated: %', n;
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select
  proname as function,
  (regexp_match(regexp_replace(pg_get_functiondef(oid), '\s+', ' ', 'g'),
                'interval ''([0-9]+ [a-z]+)'''))[1] as freshness_window,
  -- Every one of these must still be SECURITY DEFINER. Rewriting a function
  -- body by hand is exactly how that gets dropped by accident.
  prosecdef as still_security_definer
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'dispatch_verified_helpers',
    'dispatch_community_helpers',
    'check_helper_network_availability'
  )

union all

select
  'helpers reachable right now (4 min)',
  (select count(*)::text from helpers_live
    where is_online and updated_at > now() - interval '4 minutes'),
  null

union all

select
  'helpers the old window would have dispatched to',
  (select count(*)::text from helpers_live
    where is_online
      and updated_at > now() - interval '10 minutes'
      and updated_at <= now() - interval '4 minutes'),
  null;
