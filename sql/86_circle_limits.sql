-- 86_circle_limits.sql
-- ============================================================================
-- Cap circle size at 4 and rate-limit invites.
--
-- WHY A CAP AT ALL, and why 4 is a real product decision rather than a number.
--
-- A trusted circle is not a group chat. Everyone in it can see your live
-- location during an SOS, and the value of that falls off a cliff as the list
-- grows: five people who will actually come is protection, twenty acquaintances
-- is an audience. The cap is a safety feature, not a paywall.
--
-- 4 MEMBERS MEANS 4 ROWS IN circle_members, INCLUDING THE OWNER. The owner is a
-- member of their own circle in this schema, so "4 members" is the owner plus
-- three others. That reading is stated here because the alternative (owner plus
-- four) is equally defensible and somebody will change it if it is ambiguous.
--
-- Enforced in the DATABASE, not the app. A limit that lives only in the client
-- is a suggestion: anybody can call the RPC directly.
--
-- Idempotent. Run after sql/84 and sql/85.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE CAP
-- ---------------------------------------------------------------------------
create or replace function public.circle_member_limit()
returns int
language sql
immutable
as $$ select 4 $$;

comment on function public.circle_member_limit() is
  'Max live members per circle, owner included. One place to change it.';

-- ---------------------------------------------------------------------------
-- 2. ENFORCE ON INSERT AND ON UN-DELETE
-- ---------------------------------------------------------------------------
-- A trigger, not a check constraint, because the rule counts OTHER rows in the
-- table and a CHECK cannot see them.
--
-- The un-delete case is the one that is easy to miss: circle_add_member revives
-- a tombstoned row with an UPDATE rather than inserting, so an INSERT-only
-- trigger would let a circle grow past the cap by re-adding old members.
create or replace function public.enforce_circle_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  cap int := public.circle_member_limit();
begin
  -- Only care when a row is becoming live: a fresh insert, or a tombstone
  -- being cleared. Everything else cannot increase the count.
  if tg_op = 'UPDATE'
     and not (old.deleted_at is not null and new.deleted_at is null) then
    return new;
  end if;
  if tg_op = 'INSERT' and new.deleted_at is not null then
    return new;
  end if;

  -- FOR UPDATE on the parent circle serialises concurrent joins. Without it,
  -- two people accepting an invite in the same instant both count 3, both pass,
  -- and the circle ends up with 5.
  perform 1 from circles where id = new.circle_id for update;

  select count(*) into n
  from circle_members
  where circle_id = new.circle_id
    and deleted_at is null
    and id <> new.id;

  if n >= cap then
    raise exception 'circle_full'
      using errcode = '23514',
            hint = format('A circle can hold %s members, including the owner.', cap);
  end if;

  return new;
end $$;

drop trigger if exists trg_circle_member_limit on circle_members;
create trigger trg_circle_member_limit
  before insert or update on circle_members
  for each row execute function public.enforce_circle_member_limit();

-- ---------------------------------------------------------------------------
-- 3. RATE LIMIT AND CAP ON INVITES
-- ---------------------------------------------------------------------------
-- Three separate abuses, three separate guards:
--
--   a) A client loop generating thousands of invite rows. rate_ok() from
--      sql/79 stops that. No Redis in this stack; Postgres already can.
--   b) Inviting into a circle that is already full, which produces an invite
--      that cannot be accepted and looks like a bug to whoever receives it.
--   c) Piling up pending invites so that N people accept at once and blow past
--      the cap even though each invite was individually valid. Pending invites
--      count toward the cap for exactly this reason.
create or replace function public.circle_create_invite(
  p_circle   uuid,
  p_username text default null,
  p_phone    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid        uuid := auth.uid();
  my_role    text;
  cap        int := public.circle_member_limit();
  n_live     int;
  n_pending  int;
  v_token    text;
begin
  if uid is null then
    raise exception 'auth required' using errcode = '28000';
  end if;
  if p_username is null and p_phone is null then
    raise exception 'need a username or a phone number' using errcode = '22023';
  end if;

  -- 10 invites an hour. Generous for a real person filling a circle of four,
  -- and useless to a loop.
  if not public.rate_ok('invite:' || uid::text, 10, 3600) then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited');
  end if;

  select role into my_role
  from circle_members
  where circle_id = p_circle and user_id = uid and deleted_at is null;

  if my_role is null or my_role not in ('owner', 'admin') then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  perform 1 from circles where id = p_circle for update;

  select count(*) into n_live
  from circle_members
  where circle_id = p_circle and deleted_at is null;

  select count(*) into n_pending
  from circle_invites
  where circle_id = p_circle
    and status = 'pending'
    and expires_at > now();

  if n_live + n_pending >= cap then
    return jsonb_build_object(
      'ok', false,
      'reason', 'circle_full',
      'members', n_live,
      'pending', n_pending,
      'cap', cap
    );
  end if;

  -- Do not mint a second invite for somebody already invited and still pending.
  if exists (
    select 1 from circle_invites
    where circle_id = p_circle
      and status = 'pending'
      and expires_at > now()
      and ((p_username is not null and invitee_username = p_username)
        or (p_phone   is not null and invitee_phone   = p_phone))
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_invited');
  end if;

  insert into circle_invites (circle_id, inviter_id, invitee_username, invitee_phone)
  values (p_circle, uid, p_username, p_phone)
  returning token into v_token;

  return jsonb_build_object('ok', true, 'token', v_token);
end $$;

revoke all on function public.circle_create_invite(uuid, text, text) from public, anon;
grant execute on function public.circle_create_invite(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. VISITS: PAIRING ENTER AND EXIT
-- ---------------------------------------------------------------------------
-- The activity feed shows crossings; a person wants VISITS. "Left Hostel" on
-- its own answers nothing, and pairing on the client means shipping every
-- crossing to the phone and reconstructing it there on every render.
--
-- Each exit is matched to the most recent preceding enter for the same person
-- and zone. An enter with no exit yet is an ongoing visit and returns a null
-- left_at, which the UI shows as "still there".
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
security definer
set search_path = public
as $$
  with ev as (
    -- RLS on geofence_events already scopes this to circles the caller belongs
    -- to, so no user filter is applied here; adding one would hide a circle
    -- member's crossings from the rest of the circle, which is the opposite of
    -- what the feed is for.
    select e.id, e.kind, e.created_at, e.authorized, e.member_id, g.label
    from geofence_events e
    left join geofences g on g.id = e.geofence_id
  ),
  paired as (
    select
      x.id::text as visit_id,
      x.member_id,
      x.label,
      -- The enter immediately preceding this exit, same person, same zone.
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

    -- Ongoing: an enter with no exit after it.
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
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  select string_agg(n || ': ' || v, chr(10)) into msg from (
    select 'member limit trigger' as n,
           case when exists (select 1 from pg_trigger where tgname = 'trg_circle_member_limit')
                then 'ok' else 'MISSING' end as v
    union all
    select 'cap value',
           coalesce((select public.circle_member_limit()::text), 'MISSING')
    union all
    select 'invite rpc',
           case when to_regprocedure('public.circle_create_invite(uuid,text,text)') is not null
                then 'ok' else 'MISSING' end
    union all
    select 'visits rpc',
           case when to_regprocedure('public.circle_visits(int)') is not null
                then 'ok' else 'MISSING' end
  ) c;
  raise notice '%', msg;
end $$;
