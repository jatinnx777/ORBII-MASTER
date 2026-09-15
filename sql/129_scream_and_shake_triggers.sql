-- 129_scream_and_shake_triggers.sql
-- ============================================================================
-- Two new things can start an SOS, and the database has to accept them.
--
--   scream   the on-device sound model heard a confident scream, with the
--            opt-in "Scream starts an SOS" switched on, and nobody cancelled
--            the countdown
--   shake    the deliberate shake pattern, which raises a SILENT SOS
--
-- WHY THIS MATTERS MORE THAN A LABEL. sos_events.trigger is constrained
-- (sql/120). An app build that sends 'scream' or 'shake' before this runs has
-- every such SOS rejected with a check violation, and the insert is
-- fire-and-forget, so nobody sees it fail: no row means no nearby query, no
-- helper dispatch, and no arrival codes. The app now retries a rejected new
-- trigger as the nearest old one ('voice' or 'manual'), so an emergency row
-- exists either way, but only this migration keeps the real reason on it.
--
-- The reason matters to the reader of the alert. A shake is a SILENT SOS: the
-- person may be unable to talk, and calling her first can give her away.
-- notify-sos words that alert accordingly.
--
-- Idempotent. Run after sql/128.
-- ============================================================================

do $$
begin
  alter table sos_events drop constraint if exists sos_events_trigger_check;
  alter table sos_events add constraint sos_events_trigger_check
    check (trigger in ('manual', 'voice', 'impact', 'geofence', 'disaster', 'scream', 'shake'));
end $$;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'the trigger check accepts scream (must be true)' as check,
       (pg_get_constraintdef(
          (select oid from pg_constraint where conname = 'sos_events_trigger_check')
        ) ~ 'scream')::text as result
union all
select 'the trigger check accepts shake (must be true)',
       (pg_get_constraintdef(
          (select oid from pg_constraint where conname = 'sos_events_trigger_check')
        ) ~ 'shake')::text
union all
select 'every existing SOS still satisfies it (must be true)',
       (select coalesce(bool_and(trigger in
          ('manual', 'voice', 'impact', 'geofence', 'disaster', 'scream', 'shake')), true)::text
        from sos_events);
