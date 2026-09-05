-- 120_crash_trigger.sql
-- ============================================================================
-- An SOS now says what set it off, so a crash alert can stop looking like
-- every other alert.
--
-- WHY THIS COLUMN. sos_events has recorded nine things about an emergency and
-- never the one that changes what a reader should do about it. A circle
-- receiving "Aditi needs help" behaves one way. A circle receiving "Aditi's
-- phone detected a hard impact and she has not responded" behaves a different
-- way: it means she may be unconscious rather than hiding, and calling her is
-- now the wrong first move rather than the obvious one.
--
-- It also matters in the other direction. Impact detection is a heuristic on
-- unvalidated thresholds. A recipient who is told an alert came from a sensor
-- rather than from a person can weigh it accordingly, and ORBII can measure
-- how often that kind resolves as a false alarm, which is the only way the
-- thresholds ever get fixed.
--
-- 'manual' is the default and every existing row keeps it, which is true: they
-- were all fired by a person pressing something.
--
-- Idempotent. Run after sql/119.
-- ============================================================================

alter table sos_events
  add column if not exists trigger text not null default 'manual';

-- Constrained rather than free text, because this feeds notification copy and
-- an unknown value there is a push that says nothing.
--
--   manual    she pressed the button
--   voice     the wake phrase (this is ORBII's own, Life360 has no equivalent)
--   impact    the accelerometer, with no answer to the countdown
--   geofence  a zone departure she did not acknowledge
--   disaster  raised inside disaster mode
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sos_events_trigger_check'
  ) then
    alter table sos_events add constraint sos_events_trigger_check
      check (trigger in ('manual', 'voice', 'impact', 'geofence', 'disaster'));
  end if;
end $$;


-- ---------------------------------------------------------------------------
-- CARRY IT THROUGH TO THE CIRCLE
-- ---------------------------------------------------------------------------
-- Same drop-first as sql/118: the returned columns change, and `create or
-- replace` refuses that with 42P13 rather than doing anything. The grant after
-- it is load-bearing, because after sql/116 a newly created function is
-- executable by nobody until granted.
drop function if exists public.my_circle_active_sos();

create function public.my_circle_active_sos()
returns table (
  sos_id uuid, user_id uuid, name text, photo_url text,
  lat double precision, lng double precision, address text,
  created_at timestamptz, responder_count bigint, claimed_count bigint,
  trigger text
)
language sql stable security definer set search_path = public as $$
  select
    e.id,
    e.user_id,
    coalesce(u.name, e.user_name, 'Someone')::text,
    coalesce(u.photo_url, e.user_photo)::text,
    e.lat,
    e.lng,
    e.address,
    e.created_at,
    (select count(*) from rescue_events r where r.sos_id = e.id),
    (select count(*) from sos_escalations x
      where x.sos_id = e.id and x.released_at is null),
    coalesce(e.trigger, 'manual')::text
  from sos_events e
  left join users_public u on u.id = e.user_id
  where e.status = 'active'
    and e.kind = 'real'
    and e.user_id <> auth.uid()
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
  order by e.created_at desc;
$$;

revoke all on function public.my_circle_active_sos() from public, anon;
grant execute on function public.my_circle_active_sos() to authenticated;


-- ---------------------------------------------------------------------------
-- HOW OFTEN DOES THE SENSOR CRY WOLF
-- ---------------------------------------------------------------------------
-- The number that decides whether impact detection can stay on. A crash alert
-- that is wrong most of the time is worse than no crash alert, because a
-- circle learns to discount it and then discounts the real one.
--
-- Read it after a fortnight with the feature armed on any phone at all. If
-- cancelled_pct for 'impact' is materially worse than for 'manual', the
-- thresholds in volumetricShock.ts are wrong and it goes back to shadow mode.
create or replace function public.admin_trigger_reliability()
returns table (trigger text, total bigint, cancelled bigint, cancelled_pct numeric)
language sql stable security definer set search_path = public as $$
  select
    coalesce(e.trigger, 'manual')::text,
    count(*),
    count(*) filter (where e.status = 'cancelled'),
    round(100.0 * count(*) filter (where e.status = 'cancelled')
          / nullif(count(*), 0), 1)
  from sos_events e
  where public.am_i_admin()
    and e.kind = 'real'
    and e.created_at > now() - interval '90 days'
  group by 1
  order by 2 desc;
$$;

revoke all on function public.admin_trigger_reliability() from public, anon;
grant execute on function public.admin_trigger_reliability() to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'an SOS records what set it off' as check,
       (exists (select 1 from information_schema.columns
                where table_name = 'sos_events' and column_name = 'trigger'))::text as result
union all
select 'every existing SOS reads as manual (must be true)',
       (select coalesce(bool_and(trigger = 'manual'), true)::text from sos_events)
union all
select 'the circle screen can see the trigger',
       (pg_get_function_result(to_regprocedure('public.my_circle_active_sos()')) ~ 'trigger')::text
union all
select 'the app can still read circle SOS (must be true)',
       public.orbii_can_exec('authenticated', 'public.my_circle_active_sos()')
union all
select 'anon cannot (must be false)',
       has_function_privilege('anon', 'public.my_circle_active_sos()', 'execute')::text
union all
-- The reliability view is admin-gated inside its body, the same pattern every
-- other admin_ function in this schema uses.
select 'the reliability view is admin gated',
       (select prosrc ~ 'am_i_admin' from pg_proc
        where proname = 'admin_trigger_reliability'
          and pronamespace = 'public'::regnamespace)::text;
