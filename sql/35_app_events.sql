-- ORBII app events. Paste into Supabase SQL Editor and run once. Idempotent.
--
-- Why: services/analytics.ts `trackEvent` only console.log'd in __DEV__, so in
-- every release build ALL analytics went nowhere. Dozens of call sites
-- (sos_triggered, contact_added, helper_arrived, setup_completed, …) have been
-- silently discarded. This gives them a real sink.
--
-- The single most valuable number it unlocks: how often a VOICE-triggered SOS
-- gets cancelled during the 5s countdown. That cancel rate IS the voice
-- engine's false-positive rate, and it's how you tune the thresholds with data
-- instead of guesses.
--
-- Privacy: `params` must never contain audio, transcripts or raw phone
-- numbers. Trigger metadata only (phrase label, rms, confidence, latency).

create table if not exists app_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  params jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_name_time_idx on app_events (name, created_at desc);
create index if not exists app_events_user_idx on app_events (user_id, created_at desc);

alter table app_events enable row level security;

-- Write-only from the app. There is deliberately NO select policy: clients can
-- never read the event stream. Read it from the Supabase dashboard (service
-- role), same as client_errors.
drop policy if exists "app_events insert" on app_events;
create policy "app_events insert"
  on app_events for insert
  to anon, authenticated
  with check (true);

grant insert on app_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- The query you actually want, once events start flowing:
--
--   select
--     count(*) filter (where name = 'voice_sos_cancelled') as cancelled,
--     count(*) filter (where name = 'voice_sos_confirmed') as confirmed,
--     round(100.0 * count(*) filter (where name = 'voice_sos_cancelled')
--           / nullif(count(*), 0), 1) as false_positive_pct
--   from app_events
--   where name in ('voice_sos_cancelled', 'voice_sos_confirmed')
--     and created_at > now() - interval '7 days';
--
-- Break it down by trigger phrase to find which word misfires:
--
--   select params->>'phrase' as phrase,
--          count(*) filter (where name = 'voice_sos_cancelled') as cancelled,
--          count(*) as total
--   from app_events
--   where name in ('voice_sos_cancelled','voice_sos_confirmed')
--   group by 1 order by cancelled desc;
-- ---------------------------------------------------------------------------
