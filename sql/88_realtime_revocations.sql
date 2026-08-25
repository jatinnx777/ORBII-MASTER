-- 88_realtime_revocations.sql
-- ============================================================================
-- Wire circle_revocations into the Realtime authoriser.
--
-- sql/84 created circle_revocations and had circle_remove_member() write to it,
-- then nothing ever read it. Half a mechanism is worse than none: the table
-- makes it look like removal cuts the feed, and it does not.
--
-- THE LIVE BUG, which is not the revocation table at all. orbii_can_access_sos()
-- in sql/39 grants access through this branch:
--
--   or exists (
--     select 1 from circle_members a
--     join circle_members b on a.circle_id = b.circle_id
--     where a.user_id = e.user_id and b.user_id = auth.uid()
--   )
--
-- No deleted_at filter on either side. sql/84 turned removal into a soft delete,
-- so from that moment every removed member kept passing this check. Somebody
-- thrown out of a circle could still subscribe to the victim's live location
-- feed during an SOS. That is the single worst thing this table gates, and the
-- migration that introduced soft deletes is what opened it.
--
-- Idempotent. Run after sql/84, sql/85 and sql/86.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. THE AUTHORISER
-- ---------------------------------------------------------------------------
create or replace function public.orbii_can_access_sos(p_sos uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from sos_events e
    where e.id = p_sos
      and (
        -- The victim herself. Never gated: she must always reach her own SOS,
        -- including if she has been removed from every circle she was in.
        e.user_id = auth.uid()

        -- Someone who shares a LIVE circle with the victim. Both sides must be
        -- live: a tombstoned row on either end is not a membership.
        or exists (
          select 1
          from circle_members a
          join circle_members b on a.circle_id = b.circle_id
          where a.user_id = e.user_id
            and b.user_id = auth.uid()
            and a.deleted_at is null
            and b.deleted_at is null
            -- Belt and braces. deleted_at already excludes a removed member;
            -- this also covers a row hard-deleted and reinserted by hand, and
            -- makes the revocation table load-bearing rather than decorative.
            and not exists (
              select 1 from circle_revocations rv
              where rv.circle_id = a.circle_id
                and rv.user_id = auth.uid()
            )
        )

        -- A helper who has accepted THIS SOS.
        or exists (
          select 1 from rescue_events r
          where r.sos_id = p_sos and r.helper_id = auth.uid()
        )

        -- A verified helper, premium SOS only. Free users' SOS is circle-only
        -- and must never reach the stranger pool.
        or (
          coalesce(e.circle_only, false) = false
          and exists (
            select 1 from helper_profiles hp
            where hp.user_id = auth.uid()
              and hp.verification_status = 'verified'
          )
        )
      )
  );
$$;

grant execute on function public.orbii_can_access_sos(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. WHAT THIS DOES NOT DO, STATED PLAINLY
-- ---------------------------------------------------------------------------
-- Supabase Realtime evaluates these policies when a client JOINS a topic. It
-- does not re-run them on every frame for an already-joined socket. So section
-- 1 stops a removed member from joining, and does NOT close a socket they
-- already have open. sql/84's comment claimed the revocation counter "turns a
-- stale socket into a rejected one on its very next frame". That was wrong, and
-- believing it is how you end up shipping a removal button that does not remove.
--
-- Closing an open socket from SQL is not possible. What works is moving the
-- conversation somewhere the revoked member cannot follow: the topic carries an
-- epoch, and revoking bumps it. The publisher hops to the new topic, the old
-- socket stays open and receives nothing, because nobody is talking there.
--
-- The topic becomes:   sos-victim:<sos_id>:<epoch>
--
-- The existing policies extract the id with split_part(topic, ':', 2), which
-- still returns the uuid with a third segment present, so they keep working
-- unchanged and an old client that omits the epoch is unaffected.
create or replace function public.orbii_sos_channel_epoch(p_sos uuid)
returns int
language sql
security definer
set search_path = public
stable
as $$
  -- Count of revocations touching any circle the victim belongs to. Monotonic
  -- for a given SOS: it only ever grows, so it cannot collide with a topic that
  -- was already used and abandoned.
  select coalesce(count(*), 0)::int
  from circle_revocations rv
  where rv.circle_id in (
    select m.circle_id
    from circle_members m
    join sos_events e on e.user_id = m.user_id
    where e.id = p_sos
  );
$$;

grant execute on function public.orbii_sos_channel_epoch(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. VERIFY
-- ---------------------------------------------------------------------------
do $$
declare
  src text;
  ok_soft boolean;
  ok_revoke boolean;
begin
  select prosrc into src from pg_proc where proname = 'orbii_can_access_sos' limit 1;
  if src is null then
    raise exception 'orbii_can_access_sos is missing. Run sql/39 first.';
  end if;

  ok_soft   := src like '%a.deleted_at is null%' and src like '%b.deleted_at is null%';
  ok_revoke := src like '%circle_revocations%';

  raise notice 'circle join honours soft delete : %', ok_soft;
  raise notice 'authoriser reads revocations    : %', ok_revoke;
  raise notice 'epoch function                  : %',
    (to_regprocedure('public.orbii_sos_channel_epoch(uuid)') is not null);

  if not ok_soft then
    raise exception
      'The circle branch still ignores deleted_at: removed members can subscribe to live location.';
  end if;
end $$;
