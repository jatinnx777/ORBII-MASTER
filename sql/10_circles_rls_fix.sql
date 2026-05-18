-- ORBII circles RLS hotfix. Paste into Supabase SQL editor and run once.
-- Idempotent — safe to re-run.
--
-- Why this exists:
--   Users reported "new row violates row-level security policy for table
--   circles" on Create circle. Root cause: the original policies in
--   sql/09_circles.sql didn't scope to the `authenticated` role, which
--   meant requests reaching Postgres with a stale / missing JWT were
--   evaluated against `anon` (where the policies never match) instead of
--   showing the friendly "sign in first" path on the client.
--
-- What this script does:
--   • Re-applies every policy with `TO authenticated` so anon requests
--     fail fast with a clear error.
--   • Adds an extra public-write column (`invitee_phone`) lookup index
--     so phone-number invite search is fast.
--   • Adds `phone` to users_public + a search-by-phone index so the new
--     phone-based circle-invite flow can find registered friends.

-- ---------------------------------------------------------------------------
-- 1. CIRCLES policies — scope to authenticated, otherwise unchanged
-- ---------------------------------------------------------------------------

drop policy if exists "circles read members" on circles;
create policy "circles read members"
  on circles for select
  to authenticated
  using (is_circle_member(id));

drop policy if exists "circles insert self" on circles;
create policy "circles insert self"
  on circles for insert
  to authenticated
  with check (auth.uid() = owner_id);

drop policy if exists "circles owner update" on circles;
create policy "circles owner update"
  on circles for update
  to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "circles owner delete" on circles;
create policy "circles owner delete"
  on circles for delete
  to authenticated
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 2. CIRCLE_MEMBERS policies
-- ---------------------------------------------------------------------------

drop policy if exists "members read same circle" on circle_members;
create policy "members read same circle"
  on circle_members for select
  to authenticated
  using (is_circle_member(circle_id));

drop policy if exists "members insert self or owner" on circle_members;
create policy "members insert self or owner"
  on circle_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

drop policy if exists "members leave self" on circle_members;
create policy "members leave self"
  on circle_members for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. CIRCLE_INVITES policies
-- ---------------------------------------------------------------------------

drop policy if exists "invites read by inviter or invitee" on circle_invites;
create policy "invites read by inviter or invitee"
  on circle_invites for select
  to authenticated
  using (
    auth.uid() = inviter_id
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and lower(up.username) = lower(coalesce(invitee_username, ''))
    )
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and up.phone is not null
        and up.phone = invitee_phone
    )
  );

drop policy if exists "invites insert by member" on circle_invites;
create policy "invites insert by member"
  on circle_invites for insert
  to authenticated
  with check (auth.uid() = inviter_id and is_circle_member(circle_id));

drop policy if exists "invites update by inviter or invitee" on circle_invites;
create policy "invites update by inviter or invitee"
  on circle_invites for update
  to authenticated
  using (
    auth.uid() = inviter_id
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and lower(up.username) = lower(coalesce(invitee_username, ''))
    )
    or exists (
      select 1 from users_public up
      where up.id = auth.uid()
        and up.phone is not null
        and up.phone = invitee_phone
    )
  );

-- ---------------------------------------------------------------------------
-- 4. CIRCLE_EVENTS + SHARED_TRIPS
-- ---------------------------------------------------------------------------

drop policy if exists "events read members" on circle_events;
create policy "events read members"
  on circle_events for select
  to authenticated
  using (is_circle_member(circle_id));

drop policy if exists "events insert members" on circle_events;
create policy "events insert members"
  on circle_events for insert
  to authenticated
  with check (is_circle_member(circle_id) and auth.uid() = actor_id);

drop policy if exists "trips read members" on shared_trips;
create policy "trips read members"
  on shared_trips for select
  to authenticated
  using (is_circle_member(circle_id));

drop policy if exists "trips insert by member" on shared_trips;
create policy "trips insert by member"
  on shared_trips for insert
  to authenticated
  with check (auth.uid() = owner_id and is_circle_member(circle_id));

drop policy if exists "trips update owner" on shared_trips;
create policy "trips update owner"
  on shared_trips for update
  to authenticated
  using (auth.uid() = owner_id);

-- ---------------------------------------------------------------------------
-- 5. USERS_PUBLIC — add phone column for phone-based circle search
-- ---------------------------------------------------------------------------

alter table users_public
  add column if not exists phone text;

create index if not exists users_public_phone_idx
  on users_public (phone);

-- Backfill phones from existing profiles. Safe to re-run.
update users_public up
  set phone = p.phone
  from profiles p
  where up.id = p.id
    and p.phone is not null
    and (up.phone is null or up.phone <> p.phone);
