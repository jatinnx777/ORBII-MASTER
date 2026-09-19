-- 137_users_public_updated_at_grant.sql
-- ============================================================================
-- Profile syncs have been failing for every user, silently.
--
--   42501  permission denied for table users_public
--
-- syncUsersPublic upserts the signed-in user's public record after every
-- profile change. The error is swallowed into a console.warn, so nobody saw
-- it, and the visible symptom is only that somebody's name or photo is stale
-- for the people in their circle.
--
-- WHY. PostgREST sends the upsert as INSERT ... ON CONFLICT (id) DO UPDATE.
-- ON CONFLICT DO UPDATE has to read the conflicting row, so Postgres requires
-- SELECT on every column in the SET list. sql/18 deliberately replaced the
-- table-wide SELECT grant with a column grant:
--
--     grant select (id, username, name, photo_url) on users_public
--       to authenticated;
--
-- The app's SET list also carries `updated_at` and `phone`, neither of which
-- is in it, so the whole statement was rejected before any write happened.
--
-- Established rather than guessed, with sql/checks/users_public_which_column.sql:
--
--     1. granted columns only ............ OK
--     2. plus updated_at, not granted .... FAILED
--     3. after grant select(updated_at) .. OK
--     4. the app payload, phone included . FAILED
--
-- THE TWO COLUMNS GET OPPOSITE TREATMENT, ON PURPOSE.
--
--   updated_at  is a timestamp. Granting SELECT on it exposes when a profile
--               changed and nothing else. Granted here.
--
--   phone       is NOT granted, now or ever. A signed-in user being able to
--               run `select phone from users_public` would hand anybody with
--               the app a directory of phone numbers belonging to women who
--               installed a personal safety app. sql/18 removed that on
--               purpose and it stays removed. The app stops SENDING phone
--               instead: sql/125 closed the phone directory when join codes
--               replaced it, revoked find_user_by_phone, and nothing has read
--               the column since. The failing grant was the table defending
--               itself against a write that had already lost its purpose.
--
-- Idempotent. No transaction control, nothing here can raise.
-- ============================================================================

grant select (updated_at) on table public.users_public to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'updated_at is readable, so the upsert can run (must be true)' as check,
       has_column_privilege('authenticated', 'public.users_public',
                            'updated_at', 'SELECT')::text as result
union all
select 'phone is STILL unreadable (must be false)',
       has_column_privilege('authenticated', 'public.users_public',
                            'phone', 'SELECT')::text
union all
select 'the table as a whole is STILL unreadable (must be false)',
       has_table_privilege('authenticated', 'public.users_public', 'SELECT')::text
union all
select 'phone lookup is still closed to the app (must be false)',
       has_function_privilege('authenticated',
                              'public.find_user_by_phone(text,uuid)', 'execute')::text
union all
select 'rows still carrying a phone number (see the note below)',
       (select count(*)::text from users_public where phone is not null);


-- ---------------------------------------------------------------------------
-- OPTIONAL, AND NOT RUN HERE. YOUR CALL.
-- ---------------------------------------------------------------------------
-- The last row above counts phone numbers already stored in this table. After
-- this migration nothing writes them and nothing reads them, so they are data
-- held for no reason. Clearing them is a one-way change, which is why it is
-- not in the migration:
--
--     update public.users_public set phone = null where phone is not null;
--
-- Worth doing. Do it deliberately, not as a side effect of a bug fix.
-- ---------------------------------------------------------------------------
