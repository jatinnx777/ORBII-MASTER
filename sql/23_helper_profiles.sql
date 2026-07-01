-- 23_helper_profiles.sql
-- ============================================================================
-- ORBII HELPERS — responder profile (verification, trust, recognition).
--
-- helpers_live (sql/12) holds ephemeral presence (location + online). This adds
-- the durable responder identity the Helper app dashboard reads: verification
-- status, trust score, guardian level, lifetime responses, training, category.
--
-- This app is recognition-first, NOT a gig-earnings platform — so the fields
-- are about trust + contribution, not money.
-- ============================================================================

create table if not exists helper_profiles (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  -- pending → verified → suspended. Gates whether they can go online.
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','suspended')),
  -- responder category (security, ex_serviceman, women_volunteer, ngo, etc.)
  category          text,
  training_done     boolean not null default false,
  -- 0–100, drives Guardian level + dispatch priority. Starts neutral.
  trust_score       int not null default 50 check (trust_score between 0 and 100),
  lifetime_responses int not null default 0,
  -- KYC flags (set true by the verification flow / provider webhook later).
  aadhaar_verified  boolean not null default false,
  pan_verified      boolean not null default false,
  face_verified     boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table helper_profiles enable row level security;

-- A helper manages only their OWN profile. (Verification flips to 'verified'
-- via a SECURITY DEFINER function / provider webhook, not direct client write —
-- but owner-update is fine for the non-KYC fields in the MVP.)
drop policy if exists "hp read own" on helper_profiles;
create policy "hp read own" on helper_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "hp insert own" on helper_profiles;
create policy "hp insert own" on helper_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "hp update own" on helper_profiles;
create policy "hp update own" on helper_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on helper_profiles to authenticated;

-- Atomic "I completed a response" increment (called when a helper resolves an
-- emergency). Bumps lifetime_responses; trust adjustments happen server-side
-- later via the fraud/quality pipeline.
create or replace function increment_helper_responses()
returns void language sql security definer set search_path = public as $$
  update helper_profiles
     set lifetime_responses = lifetime_responses + 1,
         updated_at = now()
   where user_id = auth.uid();
$$;

revoke all on function increment_helper_responses() from public, anon;
grant execute on function increment_helper_responses() to authenticated;
