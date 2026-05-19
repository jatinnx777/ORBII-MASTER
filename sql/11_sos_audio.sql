-- ORBII SOS audio attachment. Paste into Supabase SQL Editor and run once.
-- Idempotent — safe to re-run.
--
-- Adds:
--   • `sos_events.audio_path` — storage path of the auto-recorded 60s
--     of audio that ORBII captures when an SOS fires. Stored as
--     `<userId>/<sosId>.m4a` in the private `sos-recordings` bucket.
--   • `sos-recordings` storage bucket (private).
--   • RLS so each user can only read/write their own recordings.

alter table sos_events
  add column if not exists audio_path text;

-- ---------------------------------------------------------------------------
-- Private bucket for SOS audio
-- ---------------------------------------------------------------------------
-- Supabase auto-creates buckets when you upload, but explicit creation
-- guarantees the bucket is marked private and the policies apply on
-- first run.
insert into storage.buckets (id, name, public)
values ('sos-recordings', 'sos-recordings', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — owner-only read + write. Path layout is `<auth.uid>/<sos-id>.m4a`
-- ---------------------------------------------------------------------------
drop policy if exists "sos-recordings owner read" on storage.objects;
create policy "sos-recordings owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'sos-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sos-recordings owner write" on storage.objects;
create policy "sos-recordings owner write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sos-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sos-recordings owner update" on storage.objects;
create policy "sos-recordings owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'sos-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "sos-recordings owner delete" on storage.objects;
create policy "sos-recordings owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sos-recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
