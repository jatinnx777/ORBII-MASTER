-- 57_circle_geofence_authorize.sql
-- ============================================================================
-- Circle geofencing, "did you mean to leave?" flow.
--
-- Existing behaviour (sql for geofences + geofence_events + notify-geofence):
-- a circle member draws a zone around someone; when that person LEAVES, the
-- watchers were alerted immediately.
--
-- New behaviour the founder + E-Cell head want: when the fenced person leaves,
-- SHE is asked first, with a very different notification, "did you mean to
-- leave <zone>?" If she confirms it was intentional, the alert is cleared and
-- nobody is bothered, but the crossing stays in history. If she says no, or does
-- not answer, the person who set the zone is alerted. This kills false alarms
-- (leaving campus on purpose) without losing the real ones.
--
-- Run once in Supabase. Additive: enter events and the old path still work.
-- ============================================================================

-- authorized: null = pending (asked, no answer yet), true = she confirmed it was
-- intentional, false = she said it was not / it was escalated to the watchers.
alter table geofence_events add column if not exists authorized boolean;
alter table geofence_events add column if not exists resolved_at timestamptz;

-- The fenced person confirms an exit was intentional. Clears the alert; the row
-- stays for history. Only the person the event is about can authorize it.
create or replace function public.authorize_geofence_event(p_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth required'; end if;
  update geofence_events
    set authorized = true, resolved_at = now()
  where id = p_event and member_id = uid and authorized is null;
  return found;
end $$;

grant execute on function public.authorize_geofence_event(uuid) to authenticated;

-- The fenced person says it was NOT intentional (or is escalating). Marks the
-- event so the watchers should be alerted. The client then invokes
-- notify-geofence to push whoever set the zone.
create or replace function public.deny_geofence_event(p_event uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then raise exception 'auth required'; end if;
  update geofence_events
    set authorized = false, resolved_at = now()
  where id = p_event and member_id = uid and authorized is null;
  return found;
end $$;

grant execute on function public.deny_geofence_event(uuid) to authenticated;

-- The fenced person's own pending prompts (for when she opens the app and the
-- notification was missed). Newest first.
create or replace function public.my_pending_geofence_leaves()
returns table (event_id uuid, geofence_id uuid, label text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select e.id, e.geofence_id, g.label, e.created_at
  from geofence_events e
  join geofences g on g.id = e.geofence_id
  where e.member_id = auth.uid()
    and e.kind = 'exit'
    and e.authorized is null
  order by e.created_at desc
  limit 20;
$$;

grant execute on function public.my_pending_geofence_leaves() to authenticated;

-- Safety net for "no answer": returns exit events still pending after p_minutes,
-- so a scheduled job (pg_cron or an external ping) can escalate them to the
-- watchers. Without a scheduler this simply is not called; the explicit "not me"
-- action still escalates immediately. service_role only.
create or replace function public.sweep_pending_geofence_leaves(p_minutes int default 5)
returns table (event_id uuid, geofence_id uuid, member_id uuid)
language sql
security definer
set search_path = public
as $$
  select e.id, e.geofence_id, e.member_id
  from geofence_events e
  where e.kind = 'exit'
    and e.authorized is null
    and e.created_at < now() - make_interval(mins => p_minutes);
$$;

revoke all on function public.sweep_pending_geofence_leaves(int) from public, anon, authenticated;
grant execute on function public.sweep_pending_geofence_leaves(int) to service_role;
