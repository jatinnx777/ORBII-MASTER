-- ORBII performance indexes. Idempotent — safe to re-run.
--
-- Targets ONLY the tables that exist in this Supabase project:
--   profiles, users_public, messages, sos_events, emergency_contacts.
--
-- The friends + friend_requests tables don't exist yet — they live in
-- sql/08_friends_tables.sql which both creates and indexes them. Run
-- that AFTER this file.

-- ---------------------------------------------------------------------------
-- 0. pg_trgm extension — required by the username/name search indexes.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. profiles
--    Hot paths: lookup by id (already covered by primary key), lookup by
--    username (case-insensitive). The lower(username) functional index
--    makes "username taken" checks instant and matches the duplicate
--    check in handle_new_user().
-- ---------------------------------------------------------------------------
create index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

-- ---------------------------------------------------------------------------
-- 2. users_public
--    Hot paths: substring search on username + name (the Friends search
--    UI). Trigram GIN indexes turn `ilike '%query%'` from a sequential
--    scan into a hash lookup. Plus a lower() prefix index for explicit
--    handle resolution (getPublicUserByUsername).
-- ---------------------------------------------------------------------------
create index if not exists users_public_username_lower_idx
  on public.users_public (lower(username));

create index if not exists users_public_username_trgm
  on public.users_public using gin (username gin_trgm_ops);

create index if not exists users_public_name_trgm
  on public.users_public using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. messages
--    Hot path: fetchRecentMessages() runs an .or() over both directions
--    of a user pair, ordered by created_at desc. Two composite indexes —
--    one per direction — let Postgres satisfy the OR with two index
--    scans + a merge instead of a heap scan.
-- ---------------------------------------------------------------------------
create index if not exists messages_sender_receiver_created_idx
  on public.messages (sender_id, receiver_id, created_at desc);

create index if not exists messages_receiver_sender_created_idx
  on public.messages (receiver_id, sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. sos_events
--    Hot paths: SOS history per user (auth fetch on signin), active
--    alerts feed (helpers nearby), and the receiver-side "is this row
--    still active" check.
-- ---------------------------------------------------------------------------
create index if not exists sos_events_user_created_idx
  on public.sos_events (user_id, created_at desc);

-- Partial index — only active alerts. Tiny on disk, fast for the
-- helper-side broadcast backfill query.
create index if not exists sos_events_active_idx
  on public.sos_events (created_at desc) where status = 'active';

-- ---------------------------------------------------------------------------
-- 5. emergency_contacts
--    Hot path: list all contacts for the current user, ordered by when
--    they were added. Hits this on every signin to hydrate the profile.
-- ---------------------------------------------------------------------------
create index if not exists emergency_contacts_user_created_idx
  on public.emergency_contacts (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Sanity check — list every index on the targeted tables.
-- ---------------------------------------------------------------------------
select tablename, indexname
from pg_indexes
where schemaname = 'public'
  and tablename in (
    'profiles', 'users_public', 'messages', 'sos_events', 'emergency_contacts'
  )
order by tablename, indexname;
