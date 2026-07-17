-- 44_circles_rls_fix.sql
-- ============================================================================
-- Fix: "new row violates row-level security policy for table circles" when
-- creating a circle.
--
-- Cause: the circles INSERT policy is missing or stale in the project, so the
-- owner's own insert is refused. This re-applies the full, correct policy set
-- for circles + circle_members and the owner-membership trigger. Idempotent —
-- safe to run any number of times.
-- ============================================================================

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;

-- NOTE: is_circle_member(uuid) already exists from an earlier migration and the
-- policies below depend on it, so we deliberately DO NOT redefine it here
-- (Postgres refuses to rename its parameter, and dropping it would cascade the
-- policies). We just call the existing function by position — the internal
-- parameter name doesn't matter to callers.

-- ── circles ────────────────────────────────────────────────────────────────
-- INSERT: you may create a circle only as yourself (owner_id = you).
drop policy if exists "circles insert self" on public.circles;
create policy "circles insert self"
  on public.circles for insert
  to authenticated
  with check (auth.uid() = owner_id);

-- SELECT: the owner, or any member, can read it.
drop policy if exists "circles read members" on public.circles;
create policy "circles read members"
  on public.circles for select
  to authenticated
  using (auth.uid() = owner_id or public.is_circle_member(id));

drop policy if exists "circles owner update" on public.circles;
create policy "circles owner update"
  on public.circles for update
  to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "circles owner delete" on public.circles;
create policy "circles owner delete"
  on public.circles for delete
  to authenticated
  using (auth.uid() = owner_id);

-- ── circle_members ───────────────────────────────────────────────────────
-- You can add yourself to a circle, or the circle's owner can add you.
drop policy if exists "members insert" on public.circle_members;
create policy "members insert"
  on public.circle_members for insert
  to authenticated
  with check (
    auth.uid() = user_id
    or exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

drop policy if exists "members read" on public.circle_members;
create policy "members read"
  on public.circle_members for select
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid())
    or public.is_circle_member(circle_id)
  );

drop policy if exists "members delete" on public.circle_members;
create policy "members delete"
  on public.circle_members for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (select 1 from public.circles c where c.id = circle_id and c.owner_id = auth.uid())
  );

-- ── owner auto-membership ──────────────────────────────────────────────────
-- On creating a circle, add the owner as a member, so listCircles (which reads
-- via circle_members) shows it. Runs as definer, so it bypasses the member
-- insert policy.
create or replace function public.add_circle_owner_member()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.circle_members (circle_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, user_id) do nothing;
  return new;
end; $$;

drop trigger if exists circles_add_owner on public.circles;
create trigger circles_add_owner
  after insert on public.circles
  for each row execute function public.add_circle_owner_member();

-- Backfill any circle missing its owner membership.
insert into public.circle_members (circle_id, user_id, role)
select c.id, c.owner_id, 'owner'
from public.circles c
on conflict (circle_id, user_id) do nothing;
