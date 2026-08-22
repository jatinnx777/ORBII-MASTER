-- 81_arrival_codes_fix.sql
-- ============================================================================
-- Fix: the victim's screen shows no arrival code, so an arrived helper has
-- nothing to type and the loop cannot be closed.
--
-- THREE TABLES DISAGREE ABOUT WHO IS RESPONDING.
--
--   sos_responders   written by the Helpers app when somebody taps "I'm going"
--                    (dispatch.ts acceptDispatch). sos_id is TEXT.
--   rescue_events    written by notify-sos when it assigns a dispatch.
--                    sos_id is UUID.
--   profiles.is_verified        set by the OLD admin portal (sql/27)
--   helper_profiles.verification_status  set by the NEW Helpers app (sql/03)
--
-- mint_arrival_codes read ONLY rescue_events and ONLY profiles.is_verified. A
-- helper who accepted through the Helpers app therefore appeared nowhere: the
-- loop found no rows, need_shared stayed false, and the function returned an
-- empty set. The client renders the code card only when codes.length > 0, so
-- the victim saw nothing at all and the helper standing in front of her had
-- nothing to enter.
--
-- This is the same failure this codebase keeps producing: two systems that each
-- work, joined by a column nobody checked, failing silently.
--
-- THREE CHANGES.
--
--   1. Read responders from BOTH tables, with the cast each one needs.
--   2. Treat somebody as verified if EITHER source says so.
--   3. ALWAYS mint the shared code. This is the important one. The intent
--      stated in ActiveSOSScreen is "mint the code as soon as the SOS is live,
--      so it is on screen before any helper arrives", and the old logic could
--      only satisfy that if a responder row already existed. Now there is
--      always at least one code from the moment the SOS starts, and the
--      per-helper codes appear alongside it as verified helpers accept.
--
-- Idempotent. Run AFTER sql/51.
-- ============================================================================

create or replace function public.mint_arrival_codes(p_sos uuid)
returns table (
  kind text,
  assignee_id uuid,
  assignee_name text,
  code text,
  entered boolean,
  entered_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  owner uuid;
  r     record;
begin
  if uid is null then raise exception 'auth required'; end if;
  select user_id into owner from sos_events where id = p_sos;
  if owner is null or owner <> uid then raise exception 'not your SOS'; end if;

  -- 1. ALWAYS have a shared code.
  --
  -- Every unverified responder uses this one, and it is what a bystander who
  -- simply turned up reads. Minting it unconditionally means the victim's
  -- screen is never empty, which is the actual bug: a code that only exists
  -- once somebody has formally accepted is a code that does not exist at the
  -- moment she needs to hand it over.
  if not exists (
    select 1 from sos_arrival_codes c
    where c.sos_id = p_sos and c.kind = 'shared'
  ) then
    insert into sos_arrival_codes (sos_id, kind, assignee_id, code)
    values (p_sos, 'shared', null, lpad((floor(random() * 10000))::int::text, 4, '0'))
    on conflict do nothing;
  end if;

  -- 2. One personal code per VERIFIED responder, from either table.
  --
  -- A personal code is what makes an arrival attributable: it proves which
  -- specific helper stood in front of her, which is what the coin award and any
  -- later dispute both rest on. Unverified responders share the code above,
  -- because there is nothing to attribute a payment to.
  for r in
    with responders as (
      -- The Helpers app's path. sos_id is text here, so cast p_sos to match.
      select re.user_id as helper_id
      from sos_responders re
      where re.sos_id = p_sos::text
      union
      -- notify-sos's assignment path. sos_id is already uuid.
      select rv.helper_id
      from rescue_events rv
      where rv.sos_id = p_sos
    )
    select
      d.helper_id,
      -- Verified per EITHER source. The old portal wrote profiles.is_verified;
      -- the Helpers app writes helper_profiles.verification_status. Trusting
      -- only one of them is what left app-approved helpers looking unverified.
      (
        coalesce(p.is_verified, false)
        or coalesce(hp.verification_status, '') = 'verified'
      ) as verified
    from responders d
    left join profiles p on p.id = d.helper_id
    left join helper_profiles hp on hp.user_id = d.helper_id
  loop
    if r.verified then
      insert into sos_arrival_codes (sos_id, kind, assignee_id, code)
      values (
        p_sos, 'verified', r.helper_id,
        lpad((floor(random() * 10000))::int::text, 4, '0')
      )
      on conflict do nothing;
    end if;
  end loop;

  return query
    select c.kind, c.assignee_id, pr.name, c.code, c.entered, c.entered_name
    from sos_arrival_codes c
    left join profiles pr on pr.id = c.assignee_id
    where c.sos_id = p_sos
    order by (c.kind = 'shared'), c.created_at;
end $$;

revoke all on function public.mint_arrival_codes(uuid) from public, anon;
grant execute on function public.mint_arrival_codes(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Uniqueness, so the "on conflict do nothing" above actually does something.
--
-- Without these, a repeated call could mint a second shared code and the
-- victim's screen would grow a new number every fifteen seconds. The client
-- polls, so this is not hypothetical.
-- ---------------------------------------------------------------------------
create unique index if not exists sos_arrival_codes_shared_uniq
  on sos_arrival_codes (sos_id)
  where kind = 'shared';

create unique index if not exists sos_arrival_codes_assignee_uniq
  on sos_arrival_codes (sos_id, assignee_id)
  where kind = 'verified';


-- ---------------------------------------------------------------------------
-- Who is coming, for the victim's map.
--
-- The victim currently sees a count and nothing else. Someone waiting alone at
-- night should be able to watch help approach, and the data already exists in
-- helpers_live. Returns ONLY people who have actually accepted this SOS, never
-- the general on-duty pool, so this cannot become a way to see where helpers
-- are in general.
--
-- Names are first-name only and no phone number is exposed. Distance is
-- computed server-side so the victim's client never needs the helper's raw
-- coordinates to show "800 m away"... but it does need them to draw a dot, so
-- coordinates ARE returned for accepted responders only. That is the trade:
-- somebody who has agreed to come to you can be seen coming.
-- ---------------------------------------------------------------------------
create or replace function public.sos_incoming_helpers(p_sos uuid)
returns table (
  helper_id  uuid,
  name       text,
  verified   boolean,
  lat        double precision,
  lng        double precision,
  distance_m double precision,
  updated_at timestamptz,
  arrived    boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with me as (
    select e.user_id, e.lat as vlat, e.lng as vlng
    from sos_events e
    where e.id = p_sos and e.user_id = auth.uid()
  ),
  responders as (
    select r.user_id as helper_id from sos_responders r where r.sos_id = p_sos::text
    union
    select rv.helper_id from rescue_events rv where rv.sos_id = p_sos
  )
  select
    d.helper_id,
    split_part(coalesce(pr.name, 'A helper'), ' ', 1) as name,
    (coalesce(pr.is_verified, false)
      or coalesce(hp.verification_status, '') = 'verified') as verified,
    ST_Y(hl.location::geometry) as lat,
    ST_X(hl.location::geometry) as lng,
    ST_Distance(
      hl.location,
      ST_SetSRID(ST_MakePoint((select vlng from me), (select vlat from me)), 4326)::geography
    ) as distance_m,
    hl.updated_at,
    exists (
      select 1 from sos_arrival_codes c
      where c.sos_id = p_sos and c.assignee_id = d.helper_id and c.entered
    ) as arrived
  from responders d
  join me on true
  left join profiles pr on pr.id = d.helper_id
  left join helper_profiles hp on hp.user_id = d.helper_id
  left join helpers_live hl on hl.user_id = d.helper_id and hl.is_online
  where hl.location is not null
  order by distance_m asc nulls last;
$$;

revoke all on function public.sos_incoming_helpers(uuid) from public, anon;
grant execute on function public.sos_incoming_helpers(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  select string_agg(n || ': ' || v, e'\n') into msg from (
    select 'mint reads sos_responders' as n,
           case when (select prosrc from pg_proc where proname = 'mint_arrival_codes' limit 1)
                     like '%sos_responders%' then 'ok' else 'MISSING' end as v
    union all
    select 'shared code unconditional',
           case when (select prosrc from pg_proc where proname = 'mint_arrival_codes' limit 1)
                     like '%always have a shared code%'
                  or (select prosrc from pg_proc where proname = 'mint_arrival_codes' limit 1)
                     like '%kind = ''shared''%' then 'ok' else 'CHECK' end
    union all
    select 'sos_incoming_helpers',
           case when exists (select 1 from pg_proc where proname = 'sos_incoming_helpers')
                then 'ok' else 'MISSING' end
  ) c;
  raise notice e'\n%', msg;
end $$;
