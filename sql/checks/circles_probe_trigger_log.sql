-- circles_probe_trigger_log.sql
--
-- Moved out of the migration sequence with its louder sibling. This one only
-- writes to the Postgres log and is safe to leave installed, but it is still a
-- diagnostic, not a migration.
-- ============================================================================
-- A TEMPORARY DIAGNOSTIC. Not a fix. Remove it when the answer is in hand.
--
-- Every theory so far has been argued from grants and policies read at rest.
-- This reads the real request, from the real phone, as Postgres sees it.
--
-- HOW IT WORKS. A BEFORE INSERT trigger runs BEFORE the row-level security
-- WITH CHECK is evaluated, so it fires even on an insert that is about to be
-- rejected. It writes nothing to any table (a table write would roll back with
-- the failed transaction and be lost). It uses RAISE LOG, which goes straight
-- to the Postgres server log and survives the rollback.
--
-- WHAT IT PRINTS. The line begins ORBII PROBE so it is greppable:
--
--     db_role   = the Postgres role PostgREST switched into. `authenticated`
--                 means the token was accepted. `anon` means the app sent no
--                 user token and the whole outage is a session bug.
--     jwt_role  = the role claim inside the token itself.
--     auth_uid  = who Postgres thinks is asking.
--     owner_id  = who the app claimed as owner.
--
-- If db_role is authenticated and auth_uid equals owner_id, the insert should
-- have passed, and every conclusion drawn so far is wrong.
--
-- PRIVACY: logs the sub and role claims only. No email, no token, no name.
-- ============================================================================

create or replace function public.orbii_circle_insert_probe()
returns trigger
language plpgsql
as $$
declare
  v_claims text;
  v_role   text;
  v_uid    text;
begin
  -- Wrapped so this probe can never itself break circle creation. A
  -- diagnostic on a live table has to fail silently or it becomes the outage.
  begin
    v_claims := current_setting('request.jwt.claims', true);
    v_role   := coalesce(nullif(v_claims, '')::json ->> 'role', '(no claims)');
    v_uid    := coalesce(nullif(v_claims, '')::json ->> 'sub', 'NULL');

    raise log 'ORBII PROBE | db_role=% | jwt_role=% | jwt_sub=% | owner_id=% | match=%',
      current_user,
      v_role,
      v_uid,
      coalesce(new.owner_id::text, 'NULL'),
      (v_uid = coalesce(new.owner_id::text, ''));
  exception when others then
    raise log 'ORBII PROBE | probe itself failed, db_role=%', current_user;
  end;

  return new;
end;
$$;

drop trigger if exists orbii_circle_insert_probe on public.circles;
create trigger orbii_circle_insert_probe
  before insert on public.circles
  for each row execute function public.orbii_circle_insert_probe();

-- ---------------------------------------------------------------------------
-- TO REMOVE, once the log line has been read:
--
--   drop trigger if exists orbii_circle_insert_probe on public.circles;
--   drop function if exists public.orbii_circle_insert_probe();
-- ---------------------------------------------------------------------------
