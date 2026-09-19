-- circles_probe_trigger_screen.sql
--
-- LIVES IN sql/checks/ AND NOT IN THE MIGRATION SEQUENCE, DELIBERATELY.
-- It was numbered 134 while it was being used. A numbered file implies "run me
-- in order", and running this one takes circle creation down for every user
-- until its trigger is dropped again. Diagnostics do not belong in a sequence
-- somebody catches up on.
-- ============================================================================
-- TEMPORARY. Replaces the probe from sql/133 so the answer comes back on the
-- phone screen instead of in the Postgres log, which has proven unreadable in
-- the dashboard UI under time pressure.
--
-- WHILE THIS IS INSTALLED, NOBODY CAN CREATE A CIRCLE. It raises on every
-- attempt, by design. That is acceptable only because circle creation is
-- already failing for everyone, and only for the two minutes it takes to read
-- one error message. REMOVE IT IMMEDIATELY AFTER, with the block at the
-- bottom of this file.
--
-- The BEFORE INSERT trigger runs before the row-level security check, so it
-- sees the request exactly as PostgREST set it up, including on requests that
-- RLS is about to reject.
--
-- PRIVACY: reports the role and the sub claim only. No email, no token.
-- ============================================================================

create or replace function public.orbii_circle_insert_probe()
returns trigger
language plpgsql
as $$
declare
  v_claims text;
  v_role   text;
  v_sub    text;
begin
  v_claims := current_setting('request.jwt.claims', true);

  begin
    v_role := coalesce(nullif(v_claims, '')::json ->> 'role', 'NO-CLAIMS');
    v_sub  := coalesce(nullif(v_claims, '')::json ->> 'sub',  'NO-SUB');
  exception when others then
    v_role := 'UNPARSEABLE';
    v_sub  := 'UNPARSEABLE';
  end;

  raise exception
    'ORBII PROBE >> db_role=% | jwt_role=% | jwt_sub=% | owner_id=% | match=%',
    current_user,
    v_role,
    v_sub,
    coalesce(new.owner_id::text, 'NULL'),
    (v_sub = coalesce(new.owner_id::text, ''));

  return new;
end;
$$;

-- The trigger from sql/133 already points at this function, but recreate it so
-- this file stands alone if 133 was never run.
drop trigger if exists orbii_circle_insert_probe on public.circles;
create trigger orbii_circle_insert_probe
  before insert on public.circles
  for each row execute function public.orbii_circle_insert_probe();


-- ===========================================================================
-- REMOVE THE PROBE. Run this as soon as the message has been read. Circle
-- creation cannot work again until it does.
-- ===========================================================================
--
--   drop trigger if exists orbii_circle_insert_probe on public.circles;
--   drop function if exists public.orbii_circle_insert_probe();
--
-- ===========================================================================
