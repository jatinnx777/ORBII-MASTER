-- 61_circle_rls_reset.sql
-- ============================================================================
-- Consolidated reset for circle create + invite RLS. Run this if you still get
-- "new row violates row-level security policy" on creating a circle or sending
-- an invite, even while signed in with a REAL account (Google).
--
-- IMPORTANT: if you are on a phone/test/demo profile (no real Supabase session,
-- e.g. because email login isn't working yet), every write reaches the server as
-- "anon" and RLS will reject it no matter what. The fix for THAT is to sign in
-- with Google, not this file. This file only fixes the case where the policies
-- themselves are missing/wrong.
--
-- Idempotent. Run once in the Supabase SQL editor.
-- ============================================================================

-- Membership check used by the policies below.
create or replace function is_circle_member(c uuid)
returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from circle_members m where m.circle_id = c and m.user_id = auth.uid()
  );
$$;

-- circles: the owner can create their own circle.
drop policy if exists "circles insert self" on circles;
create policy "circles insert self"
  on circles for insert to authenticated
  with check (auth.uid() = owner_id);

-- circle_members: add yourself, or the circle owner adds anyone.
drop policy if exists "members insert self or owner" on circle_members;
create policy "members insert self or owner"
  on circle_members for insert to authenticated
  with check (
    auth.uid() = user_id
    or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- circle_invites: a member OR the owner can invite.
drop policy if exists "invites insert by member" on circle_invites;
create policy "invites insert by member"
  on circle_invites for insert to authenticated
  with check (
    auth.uid() = inviter_id
    and (
      is_circle_member(circle_id)
      or exists (select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid())
    )
  );

-- Backfill: every circle's owner should be a member of it.
insert into circle_members (circle_id, user_id, role)
  select c.id, c.owner_id, 'owner'
  from circles c
  where not exists (
    select 1 from circle_members m where m.circle_id = c.id and m.user_id = c.owner_id
  );
