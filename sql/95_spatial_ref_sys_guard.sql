-- 95_spatial_ref_sys_guard.sql
-- ============================================================================
-- Detect and repair tampering with SRID 4326.
--
-- WHY THIS IS A GUARD AND NOT A FIX. spatial_ref_sys is owned by
-- supabase_admin, not by us. We cannot revoke privileges on it, cannot enable
-- RLS on it, and cannot move the PostGIS extension out of the public schema. So
-- anon keeps write access through PostgREST until Supabase changes it, and this
-- is the only defence available on our side of the line.
--
-- Proven, not assumed. On 26 Aug 2026 a POST to /rest/v1/spatial_ref_sys with
-- only the anon key returned 400 on a CHECK constraint, not 401 or 403. The
-- request passed authorization and was stopped by data validation, which means
-- writes are permitted.
--
-- WHY IT MATTERS. Every distance in ORBII is geography maths on SRID 4326:
-- check_helper_network_availability (sql/83), dispatch_verified_helpers,
-- next_wave_helpers, the geofence checks. Change the ellipsoid parameters in
-- that one row and ST_Distance keeps returning a number. A wrong one. Coverage
-- says out of area for somebody standing on campus, helper ranking inverts, and
-- nothing anywhere raises an error. This is the failure class ORBII_STATE names:
-- a failure that looks exactly like the good state.
--
-- Deleting the row is louder (queries error) and therefore less dangerous.
-- Silent corruption is the case worth defending against.
--
-- Idempotent. Run after sql/93.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. WHERE TAMPERING GETS RECORDED
-- ---------------------------------------------------------------------------
-- A dedicated table, not app_events. app_events accepts inserts from anon by
-- design, so an attacker who tripped this guard could also write to the log
-- that recorded it. A security log a suspect can edit is not a log.
create table if not exists public.security_events (
  id         bigint generated always as identity primary key,
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists security_events_time_idx
  on public.security_events (created_at desc);

alter table public.security_events enable row level security;

-- No policy, deliberately. RLS with no policy denies everything, so only
-- SECURITY DEFINER functions, the service role and the SQL editor can touch
-- this. Clients must never read it: the rows say what our detection catches,
-- which tells an attacker what it does not.
revoke all on public.security_events from public, anon, authenticated;

comment on table public.security_events is
  'Tamper and integrity findings. Deliberately unreadable by clients. Deliberately '
  'not app_events, which anon can write to.';

-- ---------------------------------------------------------------------------
-- 2. THE KNOWN-GOOD DEFINITION
-- ---------------------------------------------------------------------------
-- Canonical EPSG:4326, verified byte for byte against this project's live row
-- on 26 Aug 2026 before being written down here. Hardcoding a value from memory
-- would be worse than no guard: the repair would itself be the corruption, and
-- it would run every five minutes forever.
--
-- The trailing space in proj4text is real. PostGIS stores it that way, and
-- omitting it makes the guard fire on every single run against a healthy row.
create or replace function public.orbii_wgs84_srtext()
returns text language sql immutable as $$
  select 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]'
$$;

create or replace function public.orbii_wgs84_proj4()
returns text language sql immutable as $$
  select '+proj=longlat +datum=WGS84 +no_defs '
$$;

-- ---------------------------------------------------------------------------
-- 3. THE GUARD
-- ---------------------------------------------------------------------------
-- Returns what it did, so it is useful to call by hand as well as on a
-- schedule. Never throws: it runs unattended, and a guard that dies on an edge
-- case stops guarding without telling anybody.
create or replace function public.orbii_guard_srid_4326()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_now   record;
  good_srt  text := public.orbii_wgs84_srtext();
  good_p4   text := public.orbii_wgs84_proj4();
  action    text := 'ok';
  before    jsonb := '{}'::jsonb;
begin
  select srid, auth_name, auth_srid, srtext, proj4text
    into row_now
  from spatial_ref_sys
  where srid = 4326;

  if not found then
    -- Deleted. Loud rather than silent, because every geography query is now
    -- erroring, but restore it anyway and record that it happened.
    begin
      insert into spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
      values (4326, 'EPSG', 4326, good_srt, good_p4);
      action := 'restored_deleted';
    exception when others then
      -- We may not own the table. Record the finding; a log entry somebody can
      -- read beats a silent failure to repair.
      action := 'DELETED_AND_REPAIR_FAILED';
    end;

    insert into public.security_events (kind, detail)
    values ('srid_4326_tamper',
            jsonb_build_object('action', action, 'was', 'missing'));

    return jsonb_build_object('ok', false, 'action', action);
  end if;

  -- is distinct from, not <>. A null srtext would make <> evaluate to null,
  -- the if would not fire, and the guard would sit there reporting healthy
  -- while the row was gutted.
  if row_now.auth_name  is distinct from 'EPSG'
     or row_now.auth_srid is distinct from 4326
     or row_now.srtext    is distinct from good_srt
     or row_now.proj4text is distinct from good_p4
  then
    before := jsonb_build_object(
      'auth_name', row_now.auth_name,
      'auth_srid', row_now.auth_srid,
      'srtext',    left(coalesce(row_now.srtext, '(null)'), 400),
      'proj4text', left(coalesce(row_now.proj4text, '(null)'), 200)
    );

    begin
      update spatial_ref_sys
         set auth_name = 'EPSG',
             auth_srid = 4326,
             srtext = good_srt,
             proj4text = good_p4
       where srid = 4326;
      action := 'restored_modified';
    exception when others then
      action := 'MODIFIED_AND_REPAIR_FAILED';
    end;

    insert into public.security_events (kind, detail)
    values ('srid_4326_tamper',
            jsonb_build_object('action', action, 'before', before));

    return jsonb_build_object('ok', false, 'action', action, 'before', before);
  end if;

  -- Healthy. Nothing is logged on the happy path: a row every five minutes is
  -- 105,000 rows a year of "still fine", which buries the one row that matters.
  return jsonb_build_object('ok', true, 'action', 'ok');
exception when others then
  -- Last resort. Something unexpected, and the guard still must not die.
  begin
    insert into public.security_events (kind, detail)
    values ('srid_4326_guard_error', jsonb_build_object('error', sqlerrm));
  exception when others then
    null;
  end;
  return jsonb_build_object('ok', false, 'action', 'guard_error');
end $$;

revoke all on function public.orbii_guard_srid_4326() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. THE SCHEDULE
-- ---------------------------------------------------------------------------
-- Every five minutes. Same unschedule-then-schedule shape as sql/73, so
-- re-running this file replaces the job rather than stacking a second copy.
--
-- FIVE MINUTES IS THE EXPOSURE WINDOW, not a detection delay. Corruption
-- between two runs is live for up to five minutes, and during that window
-- coverage and helper ranking are wrong. Tighter is possible; pg_cron on the
-- free tier is not guaranteed to be punctual, so a minute-by-minute job that
-- silently stops running would be worse than an honest five.
select cron.unschedule('orbii-srid-4326-guard')
  where exists (select 1 from cron.job where jobname = 'orbii-srid-4326-guard');

select cron.schedule(
  'orbii-srid-4326-guard',
  '*/5 * * * *',
  $$ select public.orbii_guard_srid_4326(); $$
);

-- ---------------------------------------------------------------------------
-- 5. VERIFY
-- ---------------------------------------------------------------------------
-- Returns rows. Run it and read it.
select 'guard function installed' as check,
       (to_regprocedure('public.orbii_guard_srid_4326()') is not null)::text as result
union all
select 'cron job scheduled',
       (exists (select 1 from cron.job where jobname = 'orbii-srid-4326-guard'))::text
union all
select 'security_events table exists',
       (to_regclass('public.security_events') is not null)::text
union all
select 'clients cannot read security_events (want false)',
       has_table_privilege('authenticated', 'public.security_events', 'select')::text
union all
-- The important one. If this says anything but ok, the row is ALREADY wrong and
-- the guard just repaired it, which means somebody has been in there.
select 'live 4326 integrity',
       (public.orbii_guard_srid_4326() ->> 'action')
union all
-- Proves the maths still works after the guard has run. A wrong ellipsoid shows
-- up here immediately.
--
-- 46,094 m is the correct answer and was measured on the live database, not
-- estimated. The first version of this comment said "about 43000" from a rough
-- mental calculation and was simply wrong: 0.379 degrees of latitude plus 0.194
-- of longitude at 28.8 N is about 46.1 km. A sanity check carrying a wrong
-- expected value teaches whoever reads it to distrust a healthy result, which is
-- worse than having no check.
select 'sanity: Sonipat to Delhi metres (want ~46094)',
       round(st_distance(
         st_point(77.0151, 28.9931)::geography,
         st_point(77.2090, 28.6139)::geography
       ))::text;
