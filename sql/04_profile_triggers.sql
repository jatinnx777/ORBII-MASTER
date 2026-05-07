-- ORBII profile auto-creation + indexes. Paste this into the Supabase
-- SQL editor and run once. Idempotent — safe to re-run.
--
-- Why this exists: the client used to be solely responsible for inserting
-- into `profiles` after a successful Google OAuth sign-in. If the user
-- closed the app on the OAuth bounce, or RLS hiccupped, the auth.users
-- row existed without a matching profile — and nobody could find them in
-- the Friends search. This trigger guarantees a profile row exists for
-- every authenticated user, no matter what the client did.

-- ---------------------------------------------------------------------------
-- 1. Function: handle_new_user
--    Runs every time a row lands in auth.users. Creates the profile and
--    users_public rows with a placeholder username derived from the
--    email — the client overwrites these once the user picks a real
--    handle in ProfileSetup.
-- ---------------------------------------------------------------------------
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
begin
  -- Derive a starting username from the email local-part. Strip dots and
  -- non-alphanum, enforce 3-20 chars and lowercase.
  base_handle := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'));
  if length(base_handle) < 3 then
    base_handle := 'orbii_' || substring(replace(new.id::text, '-', ''), 1, 8);
  end if;
  base_handle := substring(base_handle, 1, 16);
  candidate := base_handle;

  -- Find a free username. Realistically collides only on tiny handles.
  while exists (select 1 from public.profiles where username = candidate) loop
    suffix := suffix + 1;
    candidate := substring(base_handle, 1, 14) || '_' || suffix;
  end loop;

  -- Profiles table: full record, owned by the user.
  insert into public.profiles (id, email, username, name, created_at)
  values (
    new.id,
    new.email,
    candidate,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    now()
  )
  on conflict (id) do update
    set email = excluded.email
    where profiles.email is null;

  -- users_public mirror so the user is immediately searchable.
  insert into public.users_public (id, username, name, photo_url, created_at, updated_at)
  values (
    new.id,
    candidate,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'avatar_url',
    now(),
    now()
  )
  on conflict (id) do update
    set username = excluded.username,
        name = excluded.name,
        photo_url = excluded.photo_url,
        updated_at = now();

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trigger: on_auth_user_created
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing users
--    For accounts that signed up before this trigger existed.
-- ---------------------------------------------------------------------------
insert into public.profiles (id, email, username, name, created_at)
select
  u.id,
  u.email,
  -- Same fallback handle logic as the trigger.
  case
    when length(lower(regexp_replace(split_part(coalesce(u.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'))) >= 3
    then substring(lower(regexp_replace(split_part(coalesce(u.email, ''), '@', 1), '[^a-z0-9_]', '', 'g')), 1, 16)
    else 'orbii_' || substring(replace(u.id::text, '-', ''), 1, 8)
  end,
  coalesce(u.raw_user_meta_data->>'full_name', ''),
  u.created_at
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- Mirror to users_public for any profiles that exist but aren't searchable.
insert into public.users_public (id, username, name, photo_url, created_at, updated_at)
select p.id, p.username, p.name, p.photo_uri, now(), now()
from public.profiles p
where p.username is not null
  and not exists (select 1 from public.users_public u where u.id = p.id)
on conflict (id) do update
  set username = excluded.username,
      name = excluded.name,
      photo_url = excluded.photo_url,
      updated_at = now();
