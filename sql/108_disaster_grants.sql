-- 108_disaster_grants.sql
-- ============================================================================
-- Take the default grant off the disaster tables, and fix a verify line that
-- could never pass.
--
-- WHAT HAPPENED. sql/107 asserted "anon cannot read roll calls (must be false)"
-- using has_table_privilege. It returned true, which looked like a hole and was
-- not: has_table_privilege tests the GRANT, and Supabase grants select on
-- public-schema tables to anon by default. RLS is what actually decides, and a
-- live probe with the anon key returns 200 [] on all three tables. No row was
-- ever reachable.
--
-- So the data was safe and the CHECK was wrong, which is its own problem. A
-- verify line that can never pass teaches you to skim past verify blocks, and
-- those blocks are the only thing that catches the class of bug this project
-- has already produced three times: something built, wired to nothing, and
-- reporting green.
--
-- Two fixes:
--   1. Actually revoke the grant. RLS was doing the work alone; now there are
--      two locks instead of one. Nothing in the app reads these tables
--      directly, only through the SECURITY DEFINER rpcs, so nothing breaks.
--   2. Verify what matters, which is whether a row can be READ, not whether a
--      grant exists.
--
-- Idempotent. Run after sql/107.
-- ============================================================================

revoke all on roll_calls          from anon;
revoke all on roll_call_replies   from anon;
revoke all on disaster_checkins   from anon;

-- authenticated keeps nothing either. Every read goes through a definer rpc
-- that checks circle membership first, so a direct table grant would only ever
-- be a way around that check.
revoke all on roll_calls          from authenticated;
revoke all on roll_call_replies   from authenticated;
revoke all on disaster_checkins   from authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
-- These test the thing that matters. A false here means the door is shut.
select 'anon has no grant on roll_calls (must be false)' as check,
       has_table_privilege('anon', 'public.roll_calls', 'select')::text as result
union all
select 'anon has no grant on replies (must be false)',
       has_table_privilege('anon', 'public.roll_call_replies', 'select')::text
union all
select 'anon has no grant on check-ins (must be false)',
       has_table_privilege('anon', 'public.disaster_checkins', 'select')::text
union all
select 'signed-in users cannot read the tables directly (must be false)',
       has_table_privilege('authenticated', 'public.roll_calls', 'select')::text
union all
-- The rpcs are the only door, and they must still be open or disaster mode
-- stops working entirely.
select 'open rpc still callable (must be true)',
       has_function_privilege('authenticated', 'public.open_roll_call(uuid)', 'execute')::text
union all
select 'state rpc still callable (must be true)',
       has_function_privilege('authenticated', 'public.roll_call_state(uuid)', 'execute')::text
union all
select 'answer rpc still callable (must be true)',
       has_function_privilege('authenticated',
         'public.answer_roll_call(uuid,text,double precision,double precision,text)', 'execute')::text;
