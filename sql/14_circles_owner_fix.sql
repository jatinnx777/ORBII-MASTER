-- ORBII circles fix — owners couldn't create or see their own circles.
-- Paste into Supabase → SQL Editor → Run (once). Safe to re-run.
--
-- Root cause: createCircle inserts a circle then SELECTs it back, but the
-- "circles read members" policy only let MEMBERS read, and nothing added the
-- creator as a member. So the owner's read of their just-created circle was
-- denied — surfacing as a "security error" when creating a circle.
--
-- Fix:
--   1. Trigger: auto-add the owner to circle_members as 'owner' on insert.
--   2. Policy: owners can always read their own circles.
--   3. Backfill: add missing owner memberships for existing circles.

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

drop policy if exists "circles read members" on public.circles;
create policy "circles read members"
  on public.circles for select
  to authenticated
  using (is_circle_member(id) or auth.uid() = owner_id);

-- Backfill owner memberships for any circles created before this fix.
insert into public.circle_members (circle_id, user_id, role)
select c.id, c.owner_id, 'owner'
from public.circles c
on conflict (circle_id, user_id) do nothing;
