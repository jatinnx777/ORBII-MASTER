-- 18_security.sql
-- ============================================================================
-- SECURITY HARDENING for users_public (run AFTER 01/06/10).
--
-- THE BREACH (pre-fix):
--   `users_public` had  `for select using (true)`  with NO role scope, and
--   the table carried a `phone` column. The Supabase anon key ships inside
--   the APK and is trivially extractable, so ANYONE — signed in or not —
--   could dump every ORBII user's name, photo AND phone number. For a
--   women's-safety app that is a serious privacy leak.
--
-- THE FIX (two layers):
--   1. Row scope  → only signed-in (authenticated) users can read the
--      directory at all. Kills the anonymous bulk-dump.
--   2. Column scope → even signed-in users cannot SELECT the `phone`
--      column. Finding a friend by phone now goes through an exact-match
--      SECURITY DEFINER RPC that NEVER returns the number and cannot be
--      enumerated (you must already know the full number, like WhatsApp).
-- ============================================================================

-- 1. ROW SCOPE -------------------------------------------------------------
drop policy if exists "users_public read all" on users_public;
drop policy if exists "users_public read authenticated" on users_public;
create policy "users_public read authenticated"
  on users_public for select
  to authenticated
  using (true);

-- 2. COLUMN SCOPE ----------------------------------------------------------
-- Drop the blanket SELECT grant PostgREST hands out, then re-grant only the
-- non-sensitive columns. The `phone` column is intentionally excluded, so a
-- client `select phone ...` now returns "permission denied for column phone".
-- INSERT/UPDATE are untouched, so each user can still upsert their OWN phone
-- via syncUsersPublic (that write stays owner-scoped by the existing policy).
revoke select on users_public from anon;
revoke select on users_public from authenticated;
grant select (id, username, name, photo_url) on users_public to authenticated;

-- 3. EXACT-MATCH PHONE LOOKUP ---------------------------------------------
-- Runs as the table owner (SECURITY DEFINER) so it can read `phone`, but it
-- returns the profile WITHOUT the number and only on a full exact match — so
-- the directory cannot be scraped one number at a time either.
create or replace function find_user_by_phone(
  p_phone   text,
  p_exclude uuid default null
)
returns table (id uuid, username text, name text, photo_url text)
language sql
security definer
set search_path = public
as $$
  select u.id, u.username, u.name, u.photo_url
  from users_public u
  where u.phone = p_phone
    and (p_exclude is null or u.id <> p_exclude)
  limit 1;
$$;

revoke all on function find_user_by_phone(text, uuid) from public;
grant execute on function find_user_by_phone(text, uuid) to authenticated;
