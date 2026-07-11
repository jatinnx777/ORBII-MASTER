-- 39_realtime_auth.sql
-- ============================================================================
-- Lock the per-SOS live-location channels behind Realtime Authorization.
--
-- BEFORE: `sos-victim:<id>` and `sos-live:<id>` were PUBLIC broadcast topics.
-- The anon key ships inside the APK, so anyone who learned an SOS id could
-- subscribe and stream a victim's live location in real time. For a women's-
-- safety app that is the worst possible leak.
--
-- AFTER: those topics are PRIVATE. Realtime consults the policies below (which
-- run against the subscriber's JWT), so only a real participant can join:
--   • the victim herself,
--   • someone in her circle,
--   • a helper who has ACCEPTED this SOS,
--   • or — only for a PREMIUM SOS — a verified helper (the pool that SOS is
--     meant to reach). Free users' SOS is circle_only and never exposed here.
--
-- Non-participants, and anyone holding only the anon key with no account, are
-- refused at the WebSocket. This does NOT touch the public `orbii:alerts` /
-- `orbii:presence` channels — those are a separate (shared-topic) redesign.
-- ============================================================================

-- Who may see a given SOS's live location. SECURITY DEFINER so it can read the
-- relevant tables across users; it keys everything off auth.uid() (the JWT of
-- whoever is trying to subscribe).
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
        -- the victim herself
        e.user_id = auth.uid()
        -- someone who shares a circle with the victim
        or exists (
          select 1
          from circle_members a
          join circle_members b on a.circle_id = b.circle_id
          where a.user_id = e.user_id and b.user_id = auth.uid()
        )
        -- a helper who has accepted this SOS (rescue_events row exists)
        or exists (
          select 1 from rescue_events r
          where r.sos_id = p_sos and r.helper_id = auth.uid()
        )
        -- a verified helper, but ONLY for a premium SOS (free users' SOS is
        -- circle-only and must never reach the stranger/helper pool)
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

-- Realtime Authorization: policies on realtime.messages govern PRIVATE channels
-- only (config.private = true on the client). Public channels are unaffected,
-- so alerts/presence keep working exactly as before.
alter table realtime.messages enable row level security;

-- Receiving (subscribing) on a per-SOS location topic.
drop policy if exists "orbii sos location receive" on realtime.messages;
create policy "orbii sos location receive"
  on realtime.messages
  for select
  to authenticated
  using (
    (realtime.topic() like 'sos-victim:%' or realtime.topic() like 'sos-live:%')
    and public.orbii_can_access_sos(
      nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );

-- Sending (broadcasting) on a per-SOS location topic. Same participation gate:
-- the victim publishes her position on sos-victim, the responding helper theirs
-- on sos-live, and only participants can join either in the first place.
drop policy if exists "orbii sos location send" on realtime.messages;
create policy "orbii sos location send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    (realtime.topic() like 'sos-victim:%' or realtime.topic() like 'sos-live:%')
    and public.orbii_can_access_sos(
      nullif(split_part(realtime.topic(), ':', 2), '')::uuid
    )
  );
