-- circles_insert_probe.sql
-- ============================================================================
-- Everything comes back as a normal result grid. Run it all, paste both grids.
-- Writes nothing permanent.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- A. POLICIES ON circles. If this grid is EMPTY, that alone is the bug:
--    RLS enabled with zero policies denies every insert.
-- ---------------------------------------------------------------------------
select
  coalesce(policyname, '*** NO POLICIES AT ALL ***') as policyname,
  cmd,
  permissive,
  roles::text as applies_to,
  coalesce(with_check, '(none)') as with_check_expr
from pg_policies
where schemaname = 'public' and tablename = 'circles'
order by permissive, cmd, policyname;


-- ---------------------------------------------------------------------------
-- B. THE INSERT, AS A REAL USER, REPORTED AS A TABLE. Rolls back.
-- ---------------------------------------------------------------------------
begin;

create temp table probe_result (step text, detail text);
-- The block below switches to the `authenticated` role partway through, and
-- that role owns nothing here, so it must be allowed to write its findings.
grant all on probe_result to public;

do $$
declare
  v_uid   uuid;
  v_email text;
  v_err   text;
  v_state text;
begin
  -- Resolved before switching role: `authenticated` cannot read auth.users.
  select id, email into v_uid, v_email
  from auth.users order by created_at desc limit 1;

  if v_uid is null then
    insert into probe_result values ('fatal', 'no users exist in auth.users');
    return;
  end if;

  insert into probe_result values ('testing as', v_email || '  /  ' || v_uid::text);

  -- Is RLS even on, and does the table grant allow an insert at all?
  insert into probe_result
  select 'rls enabled on circles', relrowsecurity::text
  from pg_class where oid = 'public.circles'::regclass;

  insert into probe_result
  values ('authenticated has INSERT grant',
          has_table_privilege('authenticated', 'public.circles', 'INSERT')::text);

  insert into probe_result
  values ('join_code column exists (sql/125)',
          (exists (select 1 from information_schema.columns
                   where table_schema='public' and table_name='circles'
                     and column_name='join_code'))::text);

  -- Become the app.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into probe_result
  values ('auth.uid() reads as', coalesce(auth.uid()::text, 'NULL'));

  begin
    insert into public.circles (owner_id, name, kind, color, emoji, is_default)
    values (v_uid, 'RLS probe, rolled back', 'general', '#7FA86B', null, false);

    perform set_config('role', 'postgres', true);
    insert into probe_result values ('RESULT', 'INSERT SUCCEEDED');
    insert into probe_result values ('MEANING',
      'database is fine; the app is sending a token PostgREST rejects, so the insert arrives as anon');
  exception when others then
    get stacked diagnostics v_err = message_text, v_state = returned_sqlstate;
    perform set_config('role', 'postgres', true);
    insert into probe_result values ('RESULT', 'INSERT FAILED');
    insert into probe_result values ('sqlstate', v_state);
    insert into probe_result values ('error', v_err);
  end;
end $$;

select step, detail from probe_result;

rollback;
