-- Enforce ONE username per person, case-insensitively.
-- Paste into Supabase → SQL Editor → Run (once).
--
-- Before: username had a case-SENSITIVE unique constraint, so "Priya" and
-- "priya" could both be taken by different people. These case-insensitive
-- unique indexes close that gap for both the profile + public directory.
--
-- NOTE: if creation fails with "could not create unique index ... duplicate
-- key", you already have case-insensitive duplicates. Find them with:
--   select lower(username), count(*) from public.users_public
--   group by 1 having count(*) > 1;
-- ...rename the dupes, then re-run.

create unique index if not exists profiles_username_lower_uniq
  on public.profiles (lower(username))
  where username is not null;

create unique index if not exists users_public_username_lower_uniq
  on public.users_public (lower(username))
  where username is not null;
