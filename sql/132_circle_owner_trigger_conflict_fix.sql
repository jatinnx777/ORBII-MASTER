-- 132_circle_owner_trigger_conflict_fix.sql
-- ============================================================================
-- THE ACTUAL REASON NOBODY CAN CREATE A CIRCLE.
--
--   42P10: there is no unique or exclusion constraint matching the ON CONFLICT
--          specification
--
-- Not an RLS problem. The insert into circles passes its policy, and then an
-- AFTER INSERT trigger fails and takes the whole transaction down with it.
--
-- WHAT HAPPENED, IN ORDER.
--
--   sql/09 and sql/44 each created an AFTER INSERT trigger on circles that adds
--   the owner to circle_members:
--
--       insert into circle_members (circle_id, user_id, role)
--       values (new.id, new.owner_id, 'owner')
--       on conflict (circle_id, user_id) do nothing;
--
--   That matched the original unique(circle_id, user_id) constraint.
--
--   sql/84 then removed that constraint on purpose. A tombstoned membership
--   was occupying the pair and blocking anyone from being re-added after being
--   removed, so it became a PARTIAL unique index over live rows only:
--
--       create unique index circle_members_active_uq
--         on circle_members (circle_id, user_id)
--         where deleted_at is null;
--
--   Postgres will not infer a PARTIAL index from a bare ON CONFLICT (cols).
--   The inference clause has to carry the same predicate or it matches nothing,
--   which is 42P10. sql/84 knew this and got it right at its own call site
--   (line 216, `on conflict (circle_id, user_id) where deleted_at is null`).
--   It never went back and fixed the two trigger functions, and those are what
--   fire on every single circle creation.
--
-- WHY IT LOOKED LIKE AN RLS BUG. There were two faults stacked. The missing
-- insert policy that sql/131 restored was real and had to be fixed first.
-- Fixing it simply moved the failure one step later, from the policy check to
-- the trigger, and the app surfaces raw Postgres text either way.
--
-- BOTH TRIGGERS DO THE SAME JOB and both are repaired here. Removing the
-- duplicate is correct but is not an incident change: with ON CONFLICT DO
-- NOTHING the second one is harmless.
--
-- Idempotent. Run after sql/131.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. sql/09's trigger function
-- ---------------------------------------------------------------------------
create or replace function public.on_circle_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into circle_members (circle_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  -- The predicate is required: circle_members_active_uq is partial.
  on conflict (circle_id, user_id) where deleted_at is null do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. sql/44's trigger function
-- ---------------------------------------------------------------------------
create or replace function public.add_circle_owner_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.circle_members (circle_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (circle_id, user_id) where deleted_at is null do nothing;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- VERIFY. Actually creates a circle as a real user, then rolls it back.
-- ---------------------------------------------------------------------------
-- Checking the function source is not enough. The only proof that matters is
-- that an insert now survives both triggers.
do $$
declare
  v_uid uuid;
  v_err text;
  v_state text;
begin
  select id into v_uid from auth.users order by created_at desc limit 1;
  if v_uid is null then
    raise notice 'VERIFY SKIPPED: no users to test with.';
    return;
  end if;

  begin
    insert into public.circles (owner_id, name, kind, color, emoji, is_default)
    values (v_uid, 'migration 132 self-test', 'general', '#7FA86B', null, false);

    -- Undo it. The owner row the triggers just added goes with it by cascade.
    delete from public.circles
    where owner_id = v_uid and name = 'migration 132 self-test';

    raise notice 'VERIFY PASSED: a circle was created and both triggers survived.';
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    raise exception 'VERIFY FAILED: % [SQLSTATE %]', v_err, v_state;
  end;
end $$;


-- ---------------------------------------------------------------------------
-- NOTE FOR WHEN sql/125 IS APPLIED
-- ---------------------------------------------------------------------------
-- sql/125 has never run on this database: its join_code column does not exist
-- and its circles_join_code trigger is absent. It carries the SAME defect at
-- line 178, inside join_circle_by_code:
--
--     on conflict (circle_id, user_id) do update set deleted_at = null;
--
-- That needs `where deleted_at is null` added before sql/125 is applied, or
-- joining by code will fail with this same 42P10 the moment it ships.
