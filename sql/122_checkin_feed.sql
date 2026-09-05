-- 122_checkin_feed.sql
-- ============================================================================
-- Check-in, and the circle feed that reads it.
--
-- WHAT IS MISSING TODAY. Disaster mode has roll call: someone asks, everyone
-- answers. Everyday circles have nothing, so the only way to say "I got home"
-- is to leave location sharing on and hope somebody looks at a map. That is a
-- worse deal than it sounds: it trades a permanent stream of her position for
-- one sentence she wanted to send once.
--
-- WHY THIS IS NOT THE ROLL CALL TABLE. A roll call is SOLICITED and a check-in
-- is not. Putting them in one table means "I am fine" and "answer me" share a
-- schema and immediately need a column to tell them apart, then a second column
-- for the roll call they might belong to, then a nullable everything. They are
-- adjacent, not the same, and they are joined only where it matters: the feed.
--
-- WHY THE FEED HAS NO WRITE PATH. Everything in it already exists somewhere
-- else: check-ins here, arrivals in geofence_events, emergencies in sos_events.
-- A feed that stores its own copy of those drifts out of step with them the
-- first time one is edited or deleted. This reads across all three and stores
-- nothing.
--
-- THIS IS A FEED, NOT CHAT. ORBII removed offline chat and direct messages in
-- August 2026, deliberately. A feed whose entries the system itself generated
-- has no typing indicator, no read receipts, no threading, and nothing for a
-- controlling partner to interrogate line by line. The 140 character note on a
-- check-in is the entire free-text surface in this file and it should stay
-- that way.
--
-- Idempotent. Run after sql/121.
-- ============================================================================

create table if not exists circle_checkins (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  -- Optional, and that is the point. A check-in from somewhere she does not
  -- want to name is still worth sending, and forcing coordinates onto it would
  -- turn "I am safe" into "I am safe, and here is where".
  lat        double precision,
  lng        double precision,
  -- Resolved on the device, never server-side. Reverse geocoding here would be
  -- an outbound HTTP call inside a transaction on a free tier.
  place      text,
  note       text check (note is null or length(note) <= 140),
  created_at timestamptz not null default now()
);

create index if not exists circle_checkins_circle_idx
  on circle_checkins (circle_id, created_at desc);

alter table circle_checkins enable row level security;

-- No client-side policies. Every read goes through circle_feed() and every
-- write through circle_check_in(), both SECURITY DEFINER with the membership
-- gate written once. A direct-table policy would be a second copy of that gate
-- to keep in step, and sql/84 is a whole file about what happens when those
-- two copies disagree.


-- ---------------------------------------------------------------------------
-- ONE TAP
-- ---------------------------------------------------------------------------
create or replace function public.circle_check_in(
  p_circle uuid,
  p_lat double precision default null,
  p_lng double precision default null,
  p_place text default null,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then raise exception 'auth required'; end if;

  -- You may only check in to a circle you are actually in. Same live
  -- membership test used everywhere: tombstone excluded, revocation excluded
  -- even where a membership row survives.
  if not exists (
    select 1 from circle_members m
    where m.circle_id = p_circle
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and not exists (
        select 1 from circle_revocations rv
        where rv.circle_id = p_circle and rv.user_id = auth.uid()
      )
  ) then
    raise exception 'not a member of that circle';
  end if;

  -- Rate limited, because a check-in pushes to everyone. rate_ok is the same
  -- bucket helper the rest of the schema uses: six an hour is far more than
  -- anyone needs and far less than a tap-storm.
  if not public.rate_ok('circle.checkin', 6, 3600) then
    raise exception 'too many check-ins, try again later';
  end if;

  insert into circle_checkins (circle_id, user_id, lat, lng, place, note)
  values (p_circle, auth.uid(), p_lat, p_lng, p_place, nullif(btrim(p_note), ''))
  returning id into new_id;

  -- Tell the circle. Priority 6: above the presence alerts at 7, well below an
  -- SOS at 1. A check-in is good news and must never buzz like an emergency.
  perform public.push_enqueue(
    array(
      select t.token from push_tokens t
      join circle_members m on m.user_id = t.user_id
      where m.circle_id = p_circle
        and m.user_id <> auth.uid()
        and m.deleted_at is null
    ),
    jsonb_build_object(
      'title', coalesce((select u.name from users_public u where u.id = auth.uid()), 'Someone')
               || ' checked in',
      'body', coalesce(
        nullif(btrim(p_note), ''),
        case when p_place is not null then 'At ' || p_place else 'Safe and well.' end
      ),
      'data', jsonb_build_object('kind', 'circle_checkin', 'circleId', p_circle)
    ),
    6::smallint
  );

  return new_id;
end $$;

revoke all on function public.circle_check_in(uuid, double precision, double precision, text, text)
  from public, anon;
grant execute on function public.circle_check_in(uuid, double precision, double precision, text, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- THE FEED
-- ---------------------------------------------------------------------------
-- One read across three existing tables. Ordered newest first and capped,
-- because a circle two years old should not serialise two years of arrivals to
-- render one screen.
create or replace function public.circle_feed(p_circle uuid, p_limit int default 40)
returns table (
  kind text, at timestamptz, user_id uuid, name text, photo_url text,
  body text, lat double precision, lng double precision, ref uuid
)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select 1
    from circle_members m
    where m.circle_id = p_circle
      and m.user_id = auth.uid()
      and m.deleted_at is null
      and not exists (
        select 1 from circle_revocations rv
        where rv.circle_id = p_circle and rv.user_id = auth.uid()
      )
  ),
  -- Everyone currently in this circle. Used to scope arrivals and emergencies,
  -- which are recorded per person rather than per circle.
  peers as (
    select m.user_id
    from circle_members m
    where m.circle_id = p_circle and m.deleted_at is null
  ),
  rows as (
    select 'checkin'::text as kind, c.created_at as at, c.user_id,
           coalesce(c.note, case when c.place is not null then 'At ' || c.place else 'Checked in' end) as body,
           c.lat, c.lng, c.id as ref
    from circle_checkins c
    where c.circle_id = p_circle

    union all

    -- Arrivals only. A departure is an alarm that already pushed and does not
    -- belong in a scrollable history of ordinary days.
    select 'arrival', e.created_at, e.member_id,
           'Arrived at ' || coalesce(g.label, 'a place'),
           e.lat, e.lng, e.id
    from geofence_events e
    join geofences g on g.id = e.geofence_id
    where e.kind = 'enter'
      and e.member_id in (select user_id from peers)

    union all

    select 'sos', s.created_at, s.user_id,
           case coalesce(s.trigger, 'manual')
             when 'impact' then 'Possible fall or crash'
             when 'voice'  then 'Voice SOS'
             else 'SOS'
           end,
           s.lat, s.lng, null::uuid
    from sos_events s
    where s.kind = 'real'
      and s.user_id in (select user_id from peers)
  )
  select r.kind, r.at, r.user_id, u.name, u.photo_url, r.body, r.lat, r.lng, r.ref
  from rows r
  join users_public u on u.id = r.user_id
  where exists (select 1 from allowed)
  order by r.at desc
  limit least(coalesce(p_limit, 40), 200);
$$;

revoke all on function public.circle_feed(uuid, int) from public, anon;
grant execute on function public.circle_feed(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'check-ins are stored' as check,
       (to_regclass('public.circle_checkins') is not null)::text as result
union all
select 'a note cannot exceed 140 characters',
       (exists (select 1 from pg_constraint
                where conrelid = 'public.circle_checkins'::regclass
                  and contype = 'c'
                  and pg_get_constraintdef(oid) ~ '140'))::text
union all
select 'the app can check in (must be true)',
       public.orbii_can_exec('authenticated',
         'public.circle_check_in(uuid,double precision,double precision,text,text)')
union all
select 'the app can read the feed (must be true)',
       public.orbii_can_exec('authenticated', 'public.circle_feed(uuid,int)')
union all
select 'anon can do neither (must be false)',
       (has_function_privilege('anon', 'public.circle_feed(uuid,int)', 'execute')
        or has_function_privilege('anon',
             'public.circle_check_in(uuid,double precision,double precision,text,text)', 'execute'))::text
union all
-- A circle the caller is not in must return nothing rather than raising, so a
-- stale circle id in the app is an empty screen and not a crash.
select 'a circle you are not in returns nothing (must be 0)',
       (select count(*)::text from public.circle_feed('00000000-0000-0000-0000-000000000000'::uuid, 10));
