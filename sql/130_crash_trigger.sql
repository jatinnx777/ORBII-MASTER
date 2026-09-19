-- 130_crash_trigger.sql
-- ============================================================================
-- A third sensor trigger, and the database has to accept it.
--
--   crash    the speed-gated crash detector inside the Voice SOS service: she
--            was travelling at vehicle speed, the accelerometer saw a hard
--            impact, and the speed then collapsed and stayed collapsed. The
--            countdown was not cancelled.
--
-- WHY IT IS NOT 'impact'. sql/120 already has an 'impact' trigger, and it is a
-- different claim. Impact is an accelerometer on its own, which cannot tell a
-- collision from a phone hitting a tiled floor, which is why that detector was
-- set so conservatively it was never switched on. Crash has speed on both
-- sides of the event, so it is a far stronger statement and the person reading
-- the alert should be told which one they are looking at. Collapsing the two
-- would throw that away.
--
-- WHY THIS MATTERS MORE THAN A LABEL. sos_events.trigger is constrained
-- (sql/120, widened by sql/129). An app build that sends 'crash' before this
-- runs has every such SOS rejected with a check violation, and the insert is
-- fire-and-forget, so nobody sees it fail: no row means no nearby query, no
-- helper dispatch, and no arrival codes. The app retries a rejected new trigger
-- as the nearest old one, so an emergency row exists either way, but only this
-- migration keeps the real reason on it.
--
-- Idempotent. Run after sql/129.
-- ============================================================================

do $$
begin
  alter table sos_events drop constraint if exists sos_events_trigger_check;
  alter table sos_events add constraint sos_events_trigger_check
    check (trigger in (
      'manual', 'voice', 'impact', 'geofence', 'disaster', 'scream', 'shake', 'crash'
    ));
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'the trigger check accepts crash (must be true)' as check,
       (pg_get_constraintdef(
          (select oid from pg_constraint where conname = 'sos_events_trigger_check')
        ) ~ 'crash')::text as result
union all
select 'it still accepts scream and shake (must be true)',
       (pg_get_constraintdef(
          (select oid from pg_constraint where conname = 'sos_events_trigger_check')
        ) ~ 'scream'
        and pg_get_constraintdef(
          (select oid from pg_constraint where conname = 'sos_events_trigger_check')
        ) ~ 'shake')::text
union all
select 'every existing SOS still satisfies it (must be true)',
       (select coalesce(bool_and(trigger in
          ('manual', 'voice', 'impact', 'geofence', 'disaster', 'scream', 'shake', 'crash')), true)::text
        from sos_events);
