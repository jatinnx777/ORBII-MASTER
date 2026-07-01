-- 25_responder_docs.sql
-- ============================================================================
-- Responder KYC document upload (Aadhaar / PAN / selfie / profile photo).
--
-- PRIVATE bucket — unlike avatars, these are sensitive ID documents and must
-- NOT be world-readable. A responder can upload/read only their OWN folder;
-- you (admin) review them in the Supabase dashboard (Storage → responder-docs),
-- which bypasses RLS via the service role.
--
-- NOTE: storing raw Aadhaar/PAN images has DPDP/Aadhaar-Act implications. This
-- manual-review flow is fine for a pilot; for production, move to a licensed
-- KYC provider (DigiLocker / offline Aadhaar XML) instead of storing images.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('responder-docs', 'responder-docs', false)
on conflict (id) do update set public = false;

-- Owner-only: a responder can write + read ONLY files under their own <uid>/.
drop policy if exists "rdocs owner write" on storage.objects;
create policy "rdocs owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'responder-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "rdocs owner update" on storage.objects;
create policy "rdocs owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'responder-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "rdocs owner read" on storage.objects;
create policy "rdocs owner read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'responder-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Track which documents the responder uploaded + when they submitted.
alter table helper_profiles
  add column if not exists aadhaar_doc  text,
  add column if not exists pan_doc      text,
  add column if not exists selfie_doc   text,
  add column if not exists photo_doc    text,
  add column if not exists submitted_at timestamptz;
