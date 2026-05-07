-- ORBII profile-system reset. Single self-contained migration that:
--   1. Drops the broken `profiles` + `users_public` tables (both empty,
--      so there is nothing to preserve — confirmed by `select count(*)`).
--   2. Recreates them with the exact column set the client writes to.
--   3. Sets up RLS so users can read/write their own row.
--   4. Installs the auto-create trigger on auth.users so every signup
--      gets a profile + searchable mirror automatically.
--   5. Backfills the 19 existing auth.users into both tables.
--
-- DESTRUCTIVE: drops `public.profiles` and `public.users_public`. Safe
-- here because both are empty. If you have run later migrations that
-- added columns to either table for other features, ALTER instead of
-- using this script. Idempotent — re-runnable.
--
-- Paste into Supabase SQL editor and run once.

-- ---------------------------------------------------------------------------
-- 0. Tear down stale objects
-- ---------------------------------------------------------------------------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;

drop table if exists public.users_public cascade;
drop table if exists public.profiles cascade;

-- ---------------------------------------------------------------------------
-- 1. profiles — owner-private record
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text unique,
  name text,
  phone text,
  photo_uri text,
  is_helper boolean default false,
  is_verified boolean default false,
  username_changed_at timestamptz,
  photo_changed_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index profiles_username_lower_idx on public.profiles (lower(username));

alter table public.profiles enable row level security;

create policy "profiles owner read"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles owner insert"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "profiles owner update"
  on public.profiles for update
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 2. users_public — world-readable directory used by Friends search
-- ---------------------------------------------------------------------------
create table public.users_public (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text,
  photo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index users_public_username_lower_idx
  on public.users_public (lower(username));

-- pg_trgm gives us fast `ilike '%query%'` substring search across
-- username + name. Free, ships with Supabase.
create extension if not exists pg_trgm;

create index users_public_username_trgm
  on public.users_public using gin (username gin_trgm_ops);

create index users_public_name_trgm
  on public.users_public using gin (name gin_trgm_ops);

alter table public.users_public enable row level security;

create policy "users_public read all"
  on public.users_public for select
  using (true);

create policy "users_public owner insert"
  on public.users_public for insert
  with check (auth.uid() = id);

create policy "users_public owner update"
  on public.users_public for update
  using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- 3. handle_new_user — fires on auth.users INSERT
--
-- Generates a placeholder username from the email local-part. The client
-- overwrites this when the user picks their real handle in ProfileSetup.
-- Walks a numeric suffix to dodge collisions (orbii_ab12, orbii_ab12_1,
-- orbii_ab12_2 …). SECURITY DEFINER + a strict search_path so it runs
-- as the schema owner regardless of which RLS the caller has.
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
  display_name text;
  avatar text;
begin
  -- Strip the email local-part down to a-z 0-9 _.
  base_handle := lower(regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'));
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 4. Backfill all existing auth.users
--    Calls handle_new_user logic inline for the 19 zombies. After this
--    runs, every signed-in user should appear in both tables.
-- ---------------------------------------------------------------------------
do $$
declare
  rec record;
  base_handle text;
  candidate text;
  suffix int;
  display_name text;
  avatar text;
begin
  for rec in select * from auth.users loop
    base_handle := lower(regexp_replace(split_part(coalesce(rec.email, ''), '@', 1), '[^a-z0-9_]', '', 'g'));
    if length(base_handle) < 3 then
      base_handle := 'orbii_' || substring(replace(rec.id::text, '-', ''), 1, 8);
    end if;
    base_handle := substring(base_handle, 1, 16);
    candidate := base_handle;
    suffix := 0;
    while exists (
      select 1 from public.users_public where username = candidate
      union
      select 1 from public.profiles where username = candidate
    ) loop
      suffix := suffix + 1;
      candidate := substring(base_handle, 1, 14) || '_' || suffix;
    end loop;

    display_name := nullif(coalesce(rec.raw_user_meta_data->>'full_name', ''), '');
    avatar := nullif(coalesce(rec.raw_user_meta_data->>'avatar_url', ''), '');

    insert into public.profiles (id, email, username, name, photo_uri, created_at, updated_at)
    values (rec.id, rec.email, candidate, display_name, avatar, rec.created_at, now())
    on conflict (id) do nothing;

    insert into public.users_public (id, username, name, photo_url, created_at, updated_at)
    values (rec.id, candidate, display_name, avatar, rec.created_at, now())
    on conflict (id) do nothing;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Sanity check (run this AFTER the migration to confirm the fix)
-- ---------------------------------------------------------------------------
select 'auth.users' as tbl, count(*) as rows from auth.users
union all
select 'profiles', count(*) from public.profiles
union all
select 'users_public', count(*) from public.users_public;
