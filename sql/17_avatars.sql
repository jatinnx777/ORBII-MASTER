-- Public avatars bucket for profile photos.
-- Paste into Supabase → SQL Editor → Run (once).
--
-- Why: ImagePicker returns a local file:// path. Stored as-is, the photo
-- disappears after sign-out / on another device. We upload it here and store
-- the public URL, so the profile photo survives a re-login.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

-- Anyone can view avatars (they're public profile photos).
drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects for select to public
  using (bucket_id = 'avatars');

-- A user can only write/replace files under their own <uid>/ folder.
drop policy if exists "avatars owner write" on storage.objects;
create policy "avatars owner write"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
