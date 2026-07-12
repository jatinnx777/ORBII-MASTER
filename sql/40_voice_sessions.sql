-- 40_voice_sessions.sql
-- ============================================================================
-- Audit log of background Voice SOS sessions, for ORBII's legal record.
-- One row per time the user armed background protection: when it started, for
-- how long they asked, when it is due to expire, and when it actually ended
-- (manually turned off, or lapsed). Re-arming creates a new row, so the full
-- on/off history of every user's protection is reconstructable.
-- ============================================================================

create table if not exists voice_sos_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  started_at     timestamptz not null default now(),
  duration_hours int,                 -- null / 0 = until turned off
  expires_at     timestamptz,         -- started_at + duration (null if indefinite)
  ended_at       timestamptz,         -- set when it actually stops
  ended_reason   text check (ended_reason in ('manual', 'expired', 'signed_out')),
  whisper        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists voice_sos_sessions_user_idx
  on voice_sos_sessions (user_id, started_at desc);

alter table voice_sos_sessions enable row level security;

-- A user owns their own sessions and nothing else. No one can read another
-- user's protection history from the client; admin/legal access is via the
-- service role only.
drop policy if exists "voice sessions own insert" on voice_sos_sessions;
create policy "voice sessions own insert" on voice_sos_sessions
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "voice sessions own select" on voice_sos_sessions;
create policy "voice sessions own select" on voice_sos_sessions
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "voice sessions own update" on voice_sos_sessions;
create policy "voice sessions own update" on voice_sos_sessions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
