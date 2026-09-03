-- 113_circle_active_sos.sql
-- ============================================================================
-- "Is anyone I care about in trouble right now."
--
-- Nothing could answer that question. sql/21 removed the blanket active-read
-- policy on sos_events, correctly, because it let any signed-in account scrape
-- the live coordinates of every woman in an emergency in the country. Since
-- then a circle member learns about an SOS ONLY from the push notification
-- that carries its id.
--
-- Which means: miss the push, and you never find out. A phone that was on
-- silent, a notification swiped away half asleep, an app killed by an OEM
-- battery manager, and the alert is simply gone. There is no screen anywhere
-- that says "your daughter raised an alarm eleven minutes ago".
--
-- This is that screen's query, and it is what the ORBII Circle app opens on.
--
-- SAFE BECAUSE IT IS NOT A SEARCH. It takes no coordinates and no radius and
-- accepts no arguments at all. It returns only people who share a LIVE circle
-- with the caller, which is the same test orbii_can_access_sos() already
-- applies, so it widens nothing. It cannot be used to enumerate strangers,
-- which is the exact failure sql/21 exists to prevent.
--
-- Idempotent. Run after sql/112.
-- ============================================================================

create or replace function public.my_circle_active_sos()
returns table (
  sos_id      uuid,
  user_id     uuid,
  name        text,
  photo_url   text,
  lat         double precision,
  lng         double precision,
  address     text,
  created_at  timestamptz,
  responders  bigint,
  claimed     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    e.user_id,
    coalesce(u.name, e.user_name, 'Someone')::text,
    coalesce(u.photo_url, e.user_photo)::text,
    e.lat,
    e.lng,
    e.address,
    e.created_at,
    -- How many people have accepted. Zero here is the number that matters: it
    -- is the difference between "help is coming" and "the alert went out".
    (select count(*) from rescue_events r where r.sos_id = e.id),
    -- How many have taken ownership of an action (sql/109). Shown so the app
    -- can lead with "nobody has claimed the 112 call" when that is true.
    (select count(*) from sos_escalations x
      where x.sos_id = e.id and x.released_at is null)
  from sos_events e
  left join users_public u on u.id = e.user_id
  where e.status = 'active'
    and e.kind = 'real'
    and e.user_id <> auth.uid()
    -- The whole gate. Same rule as orbii_can_access_sos: a LIVE circle shared
    -- with the caller, tombstoned rows on either side excluded, and a
    -- revocation excluded even if a membership row survives.
    and exists (
      select 1
      from circle_members a
      join circle_members b on a.circle_id = b.circle_id
      where a.user_id = e.user_id
        and b.user_id = auth.uid()
        and a.deleted_at is null
        and b.deleted_at is null
        and not exists (
          select 1 from circle_revocations rv
          where rv.circle_id = a.circle_id
            and rv.user_id = auth.uid()
        )
    )
  -- Deliberately NOT time-limited. sos_events_nearby cuts off at 15 minutes
  -- because a stranger has no business seeing an old alert. Her mother does:
  -- an SOS still marked active after two hours is the most frightening row in
  -- this table and the last one that should be hidden.
  order by e.created_at desc
  limit 20;
$$;

revoke all on function public.my_circle_active_sos() from public, anon;
grant execute on function public.my_circle_active_sos() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'circle active sos rpc' as check,
       (to_regprocedure('public.my_circle_active_sos()') is not null)::text as result
union all
select 'the blanket active-read policy is still gone (must be 0)',
       (select count(*)::text from pg_policies
         where schemaname = 'public' and tablename = 'sos_events'
           and policyname = 'sos read active')
union all
select 'anon cannot call it (must be false)',
       has_function_privilege('anon', 'public.my_circle_active_sos()', 'execute')::text
union all
-- No auth.uid() in the SQL editor, so the circle test can match nobody.
select 'no circle, no rows: must be 0 from the SQL editor',
       (select count(*) from public.my_circle_active_sos())::text;
