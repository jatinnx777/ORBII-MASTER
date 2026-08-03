-- 60_circle_invite_fix.sql
-- ============================================================================
-- Fixes: "new row violates row-level security policy for table circle_invites"
-- when trying to invite someone to a circle.
--
-- Root cause: the invite INSERT policy required the inviter to already be a
-- circle MEMBER (is_circle_member). But a circle's OWNER is not always present
-- in circle_members (the owner-membership row can be missed if the sql/14
-- trigger isn't installed and the client self-insert failed), so the owner,
-- the one person who should always be able to invite, was blocked.
--
-- This: (1) backfills owner memberships, (2) lets the circle OWNER invite even
-- if the membership row is somehow missing, and (3) ensures users_public has a
-- phone column so the phone-based invite lookup works. Idempotent. Run once.
-- ============================================================================

-- 1. users_public.phone (in case sql/10 was never run) + backfill from profiles.
alter table users_public add column if not exists phone text;
create index if not exists users_public_phone_idx on users_public (phone);
update users_public up
  set phone = p.phone
  from profiles p
  where up.id = p.id and p.phone is not null
    and (up.phone is null or up.phone <> p.phone);

-- 2. Backfill owner memberships: every circle's owner should be a member of it.
insert into circle_members (circle_id, user_id, role)
  select c.id, c.owner_id, 'owner'
  from circles c
  where not exists (
    select 1 from circle_members m
    where m.circle_id = c.id and m.user_id = c.owner_id
  );

-- 3. Allow the circle OWNER (not only existing members) to send invites.
drop policy if exists "invites insert by member" on circle_invites;
create policy "invites insert by member"
  on circle_invites for insert
  to authenticated
  with check (
    auth.uid() = inviter_id
    and (
      is_circle_member(circle_id)
      or exists (
        select 1 from circles c where c.id = circle_id and c.owner_id = auth.uid()
      )
    )
  );
