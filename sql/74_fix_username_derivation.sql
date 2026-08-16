-- 74_fix_username_derivation.sql
-- ============================================================================
-- Fix: uppercase letters were being deleted from derived usernames.
--
-- handle_new_user() built the handle like this:
--
--   lower(regexp_replace(local_part, '[^a-z0-9_]', '', 'g'))
--
-- The strip runs BEFORE the lower(), and the character class is lowercase
-- only, so every capital letter in the email was treated as junk and removed:
--
--   Jatin.Kumar@gmail.com  ->  atinumar
--   JustinN@gmail.com      ->  ustinn
--   RAHUL99@gmail.com      ->  99  (too short, falls back to orbii_xxxxxxxx)
--
-- The client-side fallback in src/services/auth.ts already does it correctly
-- (.toLowerCase() first, then strip), so the two paths disagreed depending on
-- whether the DB trigger or the client created the profile.
--
-- Lowercase first, then strip. Idempotent. Run once in Supabase -> SQL Editor.
-- Existing usernames are NOT rewritten: people may already have shared their
-- handle, and a silent rename would break friend lookups.
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base_handle text;
  candidate text;
  suffix int := 0;
  display_name text;
  avatar text;
begin
  -- Lowercase FIRST so capitals survive as their lowercase form, then strip
  -- anything that is not a-z 0-9 _.
  base_handle := regexp_replace(
    lower(split_part(coalesce(new.email, ''), '@', 1)),
    '[^a-z0-9_]', '', 'g'
  );
  if length(base_handle) < 3 then
    base_handle := 'orbii_' || substring(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base_handle := substring(base_handle, 1, 16);
  candidate := base_handle;

  while exists (
    select 1 from public.users_public where username = candidate
    union
    select 1 from public.profiles where username = candidate
  ) loop
    suffix := suffix + 1;
    candidate := substring(base_handle, 1, 14) || '_' || suffix;
  end loop;

  display_name := nullif(coalesce(new.raw_user_meta_data->>'full_name', ''), '');
  avatar := nullif(coalesce(new.raw_user_meta_data->>'avatar_url', ''), '');

  insert into public.profiles (id, email, username, name, photo_uri, created_at, updated_at)
  values (new.id, new.email, candidate, display_name, avatar, now(), now())
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now()
    where public.profiles.username is null;

  insert into public.users_public (id, username, name, photo_url, created_at, updated_at)
  values (new.id, candidate, display_name, avatar, now(), now())
  on conflict (id) do update
    set username = excluded.username,
        name = excluded.name,
        photo_url = excluded.photo_url,
        updated_at = now();

  return new;
end;
$$;
