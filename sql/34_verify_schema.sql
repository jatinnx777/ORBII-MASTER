-- ORBII — schema health check. READ-ONLY: creates nothing, drops nothing.
-- Paste into Supabase → SQL Editor → Run. Anything not marked OK is why the
-- app "silently doesn't persist": syncProfile / upsertEmergencyContact /
-- uploadAvatar all swallow their errors, so a missing table or bucket looks
-- like the app losing your data on sign-out.
--
-- Rows are ordered so problems float to the top of each section.

with expected_tables(name) as (values
  -- identity + core
  ('profiles'), ('users_public'), ('emergency_contacts'),
  ('sos_events'), ('sos_responders'), ('voice_sos_usage'),
  -- circles
  ('circles'), ('circle_members'), ('circle_invites'), ('circle_events'), ('shared_trips'),
  -- social
  ('friends'), ('friend_requests'), ('messages'),
  -- premium + infra
  ('entitlements'), ('push_tokens'), ('client_errors'), ('newsletter_subscribers'),
  -- helper network + economy
  ('helper_profiles'), ('helpers_live'), ('helper_earnings'), ('payout_requests'),
  -- reward + fraud engine (sql/33)
  ('rescue_events'), ('rescue_rewards'), ('fraud_signals'),
  ('victim_contact_hashes'), ('reward_config'), ('reward_secrets')
),
expected_functions(name) as (values
  ('delete_my_account'), ('is_circle_member'), ('find_user_by_phone'),
  ('sos_events_nearby'), ('helper_stats'), ('admin_credit_earning'), ('request_payout'),
  ('normalize_phone'), ('hash_phone'), ('hash_phone_plain'),
  ('store_contact_hashes_prehashed'), ('trust_multiplier'),
  ('is_reward_eligible'), ('compute_fraud_score'), ('finalize_rescue_reward'),
  ('process_weekly_payouts'), ('rescue_accept'), ('rescue_depart'),
  ('rescue_geofence_arrival'), ('rescue_rate_by_sos'),
  ('rescue_report_movement'), ('rescue_report_signal')
),
expected_buckets(id) as (values
  ('avatars'), ('sos-recordings'), ('responder-docs')
),
expected_realtime(name) as (values
  ('circle_events'), ('shared_trips'), ('circle_members'),
  ('helper_profiles'), ('payout_requests')
)

-- 1. Tables -----------------------------------------------------------------
select '1. table' as section, e.name as object,
  case when to_regclass('public.' || e.name) is not null then 'OK' else '❌ MISSING' end as status,
  case when to_regclass('public.' || e.name) is null then 'run the migration that creates it' else '' end as fix
from expected_tables e

union all
-- 2. Row Level Security (only meaningful for tables that exist) --------------
select '2. rls', c.relname,
  case when c.relrowsecurity then 'OK' else '⚠ RLS OFF' end,
  case when c.relrowsecurity then '' else 'table is world-writable — enable RLS' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
  and c.relname in (select name from expected_tables)

union all
-- 3. Functions ---------------------------------------------------------------
select '3. function', e.name,
  case when exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = e.name
  ) then 'OK' else '❌ MISSING' end,
  ''
from expected_functions e

union all
-- 4. Storage buckets ---------------------------------------------------------
-- 'avatars' missing is the #1 cause of the profile photo vanishing on sign-out.
-- 'sos-recordings' is NOT yet used by the app: SOS audio is currently kept only
-- on the device, so a missing bucket breaks nothing today — it's only needed
-- once the evidence upload is wired (sql/11_sos_audio.sql creates it).
select '4. bucket', e.id,
  case
    when exists (select 1 from storage.buckets b where b.id = e.id) then 'OK'
    when e.id = 'sos-recordings' then '○ not needed yet'
    else '❌ MISSING'
  end,
  case
    when e.id = 'avatars' and not exists (select 1 from storage.buckets b where b.id = 'avatars')
      then 'run sql/17_avatars.sql — profile photos will not survive sign-out'
    when e.id = 'sos-recordings' and not exists (select 1 from storage.buckets b where b.id = 'sos-recordings')
      then 'unused today; run sql/11_sos_audio.sql before wiring evidence upload'
    else ''
  end
from expected_buckets e

union all
-- 5. Realtime publication ----------------------------------------------------
select '5. realtime', e.name,
  case when exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = e.name
  ) then 'OK' else '⚠ NOT PUBLISHED' end,
  case when exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = e.name
  ) then '' else 'live updates fall back to polling' end
from expected_realtime e

order by 1, 3, 2;
