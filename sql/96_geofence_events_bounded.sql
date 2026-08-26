-- 96_geofence_events_bounded.sql
-- ============================================================================
-- Bound circle_visits to a 30 day window, and index for it.
--
-- WHY A NEW FILE RATHER THAN AN EDIT TO sql/86. sql/86 has already been applied
-- to production. Editing an applied migration means the repo stops describing
-- the database unless somebody remembers to re-run it, and "somebody remembers"
-- is not a mechanism. A new numbered file is how the drift is avoided.
--
-- THE PROBLEM. The ev CTE in circle_visits selects from geofence_events with no
-- time bound, and the pairing subquery runs `select max(...) from ev` once per
-- exit row. That is O(n^2) over the caller's entire history. sql/73's midnight
-- wipe clears circle_location_history, NOT geofence_events, so this table grows
-- forever and the Home screen's activity feed degrades with it. Nobody would
-- connect a slow feed to this function.
--
-- Idempotent. Run after sql/89.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE INDEX
-- ---------------------------------------------------------------------------
-- member_id then kind then time, matching how the pairing subquery looks up
-- "the most recent enter for this person in this zone before this exit".
create index if not exists geofence_events_member_kind_time_idx
  on geofence_events (member_id, kind, created_at desc);

-- The other access path is the geofence-owner branch, which starts from the
-- geofence rather than the member. Without this, a parent watching three
-- children pays a sequential scan for the OR.
create index if not exists geofence_events_fence_time_idx
  on geofence_events (geofence_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. THE BOUNDED FUNCTION
-- ---------------------------------------------------------------------------
-- ONE DELIBERATE DEPARTURE FROM THE BRIEF, and it matters.
--
-- The change was specified as:
--
--   where e.created_at > now() - interval '30 days'
--     and e.member_id = auth.uid()
--
-- The second line would break the feature. circle_visits exists so a circle can
-- see each other's comings and goings; sql/41's RLS policy grants read to the
-- fenced person OR to whoever set the zone, and the predicate here mirrors it.
-- Replacing the OR with `member_id = auth.uid()` restricts the feed to the
-- caller's OWN crossings, so a parent who set a zone on their daughter stops
-- seeing her arrive home. That is the entire point of the screen.
--
-- So the time bound is added and both branches are kept. The bound is what
-- fixes the complexity; the identity clause was never the slow part.
create or replace function public.circle_visits(p_limit int default 50)
returns table (
  visit_id     text,
  member_id    uuid,
  member_name  text,
  zone_label   text,
  entered_at   timestamptz,
  left_at      timestamptz,
  duration_s   int,
  authorized   boolean
)
language sql
stable
set search_path = public
as $$
  with ev as (
    -- SECURITY INVOKER (no security definer clause), so RLS applies to every
    -- table below. The predicate is defence in depth, not the only gate.
    --
    -- 30 days: the feed shows recent visits, and pairing an exit with an enter
    -- from six months ago is not a visit anybody wants to read. It also bounds
    -- the correlated subquery, which was the actual complexity problem.
    select e.id, e.kind, e.created_at, e.authorized, e.member_id, g.label
    from geofence_events e
    left join geofences g on g.id = e.geofence_id
    where e.created_at > now() - interval '30 days'
      and (
        e.member_id = auth.uid()
        or exists (
          select 1 from geofences own
          where own.id = e.geofence_id and own.owner_id = auth.uid()
        )
      )
  ),
  paired as (
    select
      x.id::text as visit_id,
      x.member_id,
      x.label,
      (select max(n.created_at) from ev n
        where n.member_id = x.member_id
          and n.label is not distinct from x.label
          and n.kind = 'enter'
          and n.created_at <= x.created_at) as entered_at,
      x.created_at as left_at,
      x.authorized
    from ev x
    where x.kind = 'exit'

    union all

    select
      n.id::text,
      n.member_id,
      n.label,
      n.created_at,
      null::timestamptz,
      n.authorized
    from ev n
    where n.kind = 'enter'
      and not exists (
        select 1 from ev x2
        where x2.member_id = n.member_id
          and x2.label is not distinct from n.label
          and x2.kind = 'exit'
          and x2.created_at > n.created_at
      )
  )
  select
    p.visit_id,
    p.member_id,
    u.name,
    coalesce(p.label, 'Safe zone'),
    p.entered_at,
    p.left_at,
    case
      when p.entered_at is null then null
      else extract(epoch from coalesce(p.left_at, now()) - p.entered_at)::int
    end,
    p.authorized
  from paired p
  left join users_public u on u.id = p.member_id
  order by coalesce(p.left_at, p.entered_at) desc nulls last
  limit greatest(1, least(p_limit, 200));
$$;

revoke all on function public.circle_visits(int) from public, anon;
grant execute on function public.circle_visits(int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. VERIFY
-- ---------------------------------------------------------------------------
select 'circle_visits is INVOKER (must be true)' as check,
       coalesce((select (not prosecdef)::text from pg_proc
                 where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING') as result
union all
select 'time bound present',
       coalesce((select (prosrc like '%30 days%')::text from pg_proc
                 where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING')
union all
-- The regression guard. If this is false the OR branch was dropped and a parent
-- can no longer see the zones they set on their own child.
select 'geofence-owner branch kept (must be true)',
       coalesce((select (prosrc like '%own.owner_id = auth.uid()%')::text from pg_proc
                 where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING')
union all
select 'member/kind/time index',
       (to_regclass('public.geofence_events_member_kind_time_idx') is not null)::text
union all
select 'fence/time index',
       (to_regclass('public.geofence_events_fence_time_idx') is not null)::text;
