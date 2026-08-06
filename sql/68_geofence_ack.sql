-- 68_geofence_ack.sql — the fenced person's awareness + right to decline.
--
-- When someone sets a safe zone on you, you should KNOW, and be able to say no.
-- A new `member_ack` flag drives a "safe zone request" in your notifications:
-- Keep it (ack) or Decline it (deactivate so it stops monitoring you). This is
-- the consent + transparency the DPDP Act expects for being tracked. Idempotent.

alter table public.geofences
  add column if not exists member_ack boolean not null default false;

-- The fenced person keeps the zone (acknowledges it). SECURITY DEFINER so it
-- works regardless of the update RLS on geofences; it still checks that the
-- caller is the person the zone is set on.
create or replace function public.geofence_member_ack(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.geofences
  set member_ack = true
  where id = p_id and member_id = auth.uid();
$$;

-- The fenced person declines: the zone is deactivated (monitoring stops) and
-- marked acknowledged so it leaves their requests.
create or replace function public.geofence_member_decline(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.geofences
  set active = false, member_ack = true
  where id = p_id and member_id = auth.uid();
$$;

grant execute on function public.geofence_member_ack(uuid) to authenticated;
grant execute on function public.geofence_member_decline(uuid) to authenticated;
