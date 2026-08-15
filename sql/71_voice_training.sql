-- 71_voice_training.sql
-- ============================================================================
-- Opt-in voice-donation store for training ORBII's own keyword model
-- (OrbiiKWSCNN). A user MAY choose, at the voice test, to donate their short
-- "help" / "bachao" clip. Privacy is preserved by design:
--   * clips live in a PRIVATE bucket; a normal user can upload their own but can
--     never read anyone's (not even their own list),
--   * only the service-role key (used by you, offline, for training) can read,
--   * the table stores only labels + a pointer, never the audio itself,
--   * donation is strictly opt-in (enforced in the app), never automatic.
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

-- 1. Private bucket for the raw clips.
insert into storage.buckets (id, name, public)
values ('voice-training', 'voice-training', false)
on conflict (id) do nothing;

-- 2. Minimal metadata: label + pointer + a little context. No audio in the DB.
create table if not exists voice_samples (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  phrase       text not null,            -- 'help' | 'bachao' | 'madad' ...
  lang         text not null,            -- 'en' | 'hi'
  storage_path text not null,            -- e.g. '<uid>/<uuid>.m4a'
  duration_ms  int,
  device       text,                     -- coarse model string, for diversity
  consented    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table voice_samples enable row level security;

-- A signed-in user may INSERT only their own donation row. There is deliberately
-- NO select/update/delete policy, so users can never read anyone's samples; only
-- the service-role key (which bypasses RLS) can, for training.
drop policy if exists voice_samples_insert on voice_samples;
create policy voice_samples_insert on voice_samples
  for insert to authenticated
  with check (user_id = auth.uid());

-- 3. Storage policies for the bucket.
-- Upload: only into your OWN folder (first path segment must be your uid).
drop policy if exists voice_training_upload on storage.objects;
create policy voice_training_upload on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice-training'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
-- No select policy on the bucket => clips are unreadable by any user token.
-- Download/list for training happens only via the service-role key.

-- ============================================================================
-- 4. ANTI-POISONING DEFENCES (people can upload junk to mislead the model).
--    Strategy from the research: QUARANTINE every clip, RATE-LIMIT per user, and
--    never train on raw uploads, only on rows you have reviewed.
-- ============================================================================

-- Quarantine flag: every donation lands unverified. Your training script should
-- ONLY pull rows where verified = true (you flip it after a quick spot-check).
alter table voice_samples add column if not exists verified boolean not null default false;
-- Optional: mark obvious junk so you can ban repeat offenders / drop it.
alter table voice_samples add column if not exists rejected boolean not null default false;

-- Server-side rate limit: at most 40 donations per user per day. Enforced in the
-- database, so a script hammering the API can't flood the set from one account.
create or replace function public.voice_samples_ratelimit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare cnt int;
begin
  select count(*) into cnt from voice_samples
    where user_id = new.user_id and created_at > now() - interval '1 day';
  if cnt >= 40 then
    raise exception 'daily voice-donation limit reached';
  end if;
  return new;
end $$;

drop trigger if exists trg_voice_samples_ratelimit on voice_samples;
create trigger trg_voice_samples_ratelimit
  before insert on voice_samples
  for each row execute function public.voice_samples_ratelimit();

-- Speed up "today's count" + your review queue.
create index if not exists voice_samples_user_day_idx on voice_samples (user_id, created_at desc);
create index if not exists voice_samples_review_idx on voice_samples (verified, rejected, created_at desc);

-- Dedup by content hash: identical audio bytes = a duplicate (someone trying to
-- flood the set with the same clip). The unique index rejects the second insert,
-- and the app treats that as "already have it".
alter table voice_samples add column if not exists sha256 text;
create unique index if not exists voice_samples_sha_uniq on voice_samples (sha256) where sha256 is not null;
