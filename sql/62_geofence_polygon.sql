-- 62_geofence_polygon.sql
-- ============================================================================
-- Adds the 4-corner "square area" a parent draws on the map. We store the actual
-- corners the parent placed, AND keep lat/lng/radius_m as the circle that covers
-- that square, because phones can only reliably monitor CIRCULAR zones in the
-- background (even with the app closed). So: the parent draws a square, the app
-- shows the square, and the OS watches the circle that contains it. Leaving that
-- area fires the existing "left at <time>" alert (sql/41 + 57).
--
-- Idempotent. Run once.
-- ============================================================================

alter table geofences add column if not exists corners jsonb;

