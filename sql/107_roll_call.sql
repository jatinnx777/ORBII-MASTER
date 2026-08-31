-- 107_roll_call.sql
-- ============================================================================
-- Roll call. One tap asks everyone in your circle whether they are safe.
--
-- WHY THIS AND NOT MORE BROADCASTING. Disaster mode today can shout "I am safe"
-- and nothing else. Everyone can shout and nobody can hear, which is exactly
-- backwards: the thing families actually do in a disaster is find each other,
-- and the names that matter are the ones that have NOT answered.
--
-- So this is deliberately about the silence, not the replies. The screen that
-- matters lists who has not responded.
--
-- ONLINE FIRST, ON PURPOSE. This is server backed so it works the moment it
-- ships. The mesh path carries a status packet when there is no network at all,
-- but a roll call that only worked offline would be a roll call that never
-- worked, because most disasters still have patchy signal somewhere.
--
-- Idempotent. Run after sql/106.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- DISASTER CHECK-INS
-- ---------------------------------------------------------------------------
-- Where a mesh-carried "I am safe" lands.
--
-- It has its own table rather than sharing sos_events, and that separation is
-- the point: a check-in must never be able to become an emergency. If these
-- shared a table, one wrong branch in the bridge would turn somebody reassuring
-- their family into an alarm, which on this product is the cruellest possible
-- bug.
create table if not exists disaster_checkins (
  id      bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  status  text not null check (status in ('safe', 'help')),
  lat     double precision,
  lng     double precision,
  source  text not null default 'mesh',
  at      timestamptz not null default now()
);

create index if not exists disaster_checkins_user_idx on disaster_checkins (user_id, at desc);

alter table disaster_checkins enable row level security;

-- Your own check-ins, and those of anyone whose circle you are in. Nobody else.
drop policy if exists "checkins visible to circle" on disaster_checkins;
create policy "checkins visible to circle" on disaster_checkins
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from circle_members mine
      join circle_members theirs on theirs.circle_id = mine.circle_id
      where mine.user_id = auth.uid()
        and mine.deleted_at is null
        and theirs.user_id = disaster_checkins.user_id
        and theirs.deleted_at is null
    )
  );

create table if not exists roll_calls (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  opened_by  uuid not null references auth.users(id) on delete cascade,
  opened_at  timestamptz not null default now(),
  -- A roll call is about right now. An old one answered yesterday tells you
  -- nothing about today, so they expire rather than linger and mislead.
  closes_at  timestamptz not null default now() + interval '12 hours'
);

create table if not exists roll_call_replies (
  roll_call_id uuid not null references roll_calls(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null check (status in ('safe', 'help')),
  lat          double precision,
  lng          double precision,
  place        text,
  at           timestamptz not null default now(),
  primary key (roll_call_id, user_id)
);

create index if not exists roll_calls_circle_idx on roll_calls (circle_id, opened_at desc);

alter table roll_calls enable row level security;
alter table roll_call_replies enable row level security;

-- Members of the circle can see the roll call and the replies. Nobody else can,
-- and there is deliberately no way to read a roll call for a circle you are not
-- in: in a disaster this table holds who is hurt and where they are.
drop policy if exists "roll call visible to circle" on roll_calls;
create policy "roll call visible to circle" on roll_calls
  for select to authenticated
  using (exists (
    select 1 from circle_members m
    where m.circle_id = roll_calls.circle_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
  ));

drop policy if exists "replies visible to circle" on roll_call_replies;
create policy "replies visible to circle" on roll_call_replies
  for select to authenticated
  using (exists (
    select 1 from roll_calls r
    join circle_members m on m.circle_id = r.circle_id
    where r.id = roll_call_replies.roll_call_id
      and m.user_id = auth.uid()
      and m.deleted_at is null
  ));

-- ---------------------------------------------------------------------------
-- OPEN ONE
-- ---------------------------------------------------------------------------
create or replace function public.open_roll_call(p_circle uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
begin
  if not exists (
    select 1 from circle_members m
    where m.circle_id = p_circle and m.user_id = auth.uid() and m.deleted_at is null
  ) then
    raise exception 'not a member of that circle' using errcode = '42501';
  end if;

  -- Reuse an open one rather than stacking. Three people tapping at once during
  -- an earthquake must not produce three roll calls that each look half answered.
  select r.id into rid
  from roll_calls r
  where r.circle_id = p_circle and r.closes_at > now()
  order by r.opened_at desc
  limit 1;

  if rid is not null then
    return rid;
  end if;

  insert into roll_calls (circle_id, opened_by)
  values (p_circle, auth.uid())
  returning id into rid;

  -- The opener is answered by definition. They are the one asking.
  insert into roll_call_replies (roll_call_id, user_id, status)
  values (rid, auth.uid(), 'safe')
  on conflict do nothing;

  return rid;
end $$;

revoke all on function public.open_roll_call(uuid) from public, anon;
grant execute on function public.open_roll_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- ANSWER ONE
-- ---------------------------------------------------------------------------
create or replace function public.answer_roll_call(
  p_roll_call uuid,
  p_status    text,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_place     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('safe', 'help') then
    return jsonb_build_object('ok', false, 'message', 'Status must be safe or help.');
  end if;

  if not exists (
    select 1 from roll_calls r
    join circle_members m on m.circle_id = r.circle_id
    where r.id = p_roll_call and m.user_id = auth.uid() and m.deleted_at is null
  ) then
    raise exception 'not a member of that circle' using errcode = '42501';
  end if;

  -- Changing your mind is the point. Someone who said safe and then needs help
  -- must be able to say so, so this overwrites rather than refusing.
  insert into roll_call_replies (roll_call_id, user_id, status, lat, lng, place, at)
  values (p_roll_call, auth.uid(), p_status, p_lat, p_lng, p_place, now())
  on conflict (roll_call_id, user_id) do update
    set status = excluded.status,
        lat = excluded.lat,
        lng = excluded.lng,
        place = excluded.place,
        at = now();

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.answer_roll_call(uuid, text, double precision, double precision, text)
  from public, anon;
grant execute on function public.answer_roll_call(uuid, text, double precision, double precision, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- READ ONE
-- ---------------------------------------------------------------------------
-- Returns EVERY member, answered or not, because the unanswered rows are the
-- entire reason this exists. A function that returned only replies would hide
-- the people you are looking for.
create or replace function public.roll_call_state(p_roll_call uuid)
returns table (
  user_id  uuid,
  name     text,
  status   text,
  place    text,
  lat      double precision,
  lng      double precision,
  answered_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    coalesce(u.name, 'Someone')::text,
    rep.status,
    rep.place,
    rep.lat,
    rep.lng,
    rep.at
  from roll_calls r
  join circle_members m
    on m.circle_id = r.circle_id and m.deleted_at is null
  left join users_public u on u.id = m.user_id
  left join roll_call_replies rep
    on rep.roll_call_id = r.id and rep.user_id = m.user_id
  where r.id = p_roll_call
    and exists (
      select 1 from circle_members me
      where me.circle_id = r.circle_id and me.user_id = auth.uid() and me.deleted_at is null
    )
  -- Unanswered first, then anyone who needs help, then the safe ones. The
  -- ordering IS the triage.
  order by (rep.status is null) desc, (rep.status = 'help') desc, u.name;
$$;

revoke all on function public.roll_call_state(uuid) from public, anon;
grant execute on function public.roll_call_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- THE OPEN ONE FOR MY CIRCLES
-- ---------------------------------------------------------------------------
create or replace function public.my_open_roll_calls()
returns table (id uuid, circle_id uuid, opened_by uuid, opened_at timestamptz, answered boolean)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.circle_id, r.opened_by, r.opened_at,
         exists (select 1 from roll_call_replies rep
                 where rep.roll_call_id = r.id and rep.user_id = auth.uid())
  from roll_calls r
  join circle_members m
    on m.circle_id = r.circle_id and m.user_id = auth.uid() and m.deleted_at is null
  where r.closes_at > now()
  order by r.opened_at desc;
$$;

revoke all on function public.my_open_roll_calls() from public, anon;
grant execute on function public.my_open_roll_calls() to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'roll_calls table' as check,
       (to_regclass('public.roll_calls') is not null)::text as result
union all
select 'replies table', (to_regclass('public.roll_call_replies') is not null)::text
union all
select 'open rpc', (to_regprocedure('public.open_roll_call(uuid)') is not null)::text
union all
select 'answer rpc',
       (to_regprocedure('public.answer_roll_call(uuid,text,double precision,double precision,text)') is not null)::text
union all
select 'state rpc', (to_regprocedure('public.roll_call_state(uuid)') is not null)::text
union all
select 'my open roll calls', (to_regprocedure('public.my_open_roll_calls()') is not null)::text
union all
-- A stranger must never be able to read who is hurt and where.
select 'anon cannot read roll calls (must be false)',
       has_table_privilege('anon', 'public.roll_calls', 'select')::text
union all
select 'disaster_checkins table',
       (to_regclass('public.disaster_checkins') is not null)::text
union all
select 'anon cannot read check-ins (must be false)',
       has_table_privilege('anon', 'public.disaster_checkins', 'select')::text;
