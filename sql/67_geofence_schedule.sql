-- 67_geofence_schedule.sql — a per-zone time window ("should be inside" hours).
--
-- Each safe zone can carry the hours the fenced person is expected to be inside
-- it (e.g. college 9:00 to 17:00). Stored as local wall-clock times (no date);
-- the app shows them in a scrollable picker and saves them per person/zone.
-- Alerting only during the window is a follow-up; this migration just persists
-- the schedule. Idempotent.

alter table public.geofences
  add column if not exists active_from text,   -- 'HH:MM' 24h, null = all day
  add column if not exists active_to   text;   -- 'HH:MM' 24h, null = all day
