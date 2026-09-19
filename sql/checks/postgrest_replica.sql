-- postgrest_replica.sql
-- ============================================================================
-- Reproduces the EXACT statement the app's request becomes, instead of a
-- hand-written insert that resembles it.
--
-- Every probe so far has tested a simplified statement and passed, while the
-- app kept failing. PostgREST does not send `insert into circles values (...)`.
-- It sends an INSERT fed by json_to_record, wrapped in a CTE, with RETURNING,
-- wrapped again in a counting SELECT. Any one of those layers can be what
-- fails. This runs the real shape and prints the real error.
--
-- Rolls back. There is no DDL in this file, so the rollback is safe here.
-- ============================================================================

begin;

create temp table out (step text, detail text);
grant all on out to public;

do $$
declare
  v_uid   uuid := '8ee693c9-8324-4a5b-a1fe-6bc81f7b6426';
  v_body  text;
  v_sql   text;
  v_err   text;
  v_state text;
  v_hint  text;
  v_ctx   text;
begin
  if not exists (select 1 from auth.users where id = v_uid) then
    select id into v_uid from auth.users order by created_at desc limit 1;
  end if;

  insert into out values ('testing as', v_uid::text);

  -- The JSON body supabase-js sends for createCircle.
  v_body := json_build_object(
    'owner_id',   v_uid::text,
    'name',       'postgrest replica, rolled back',
    'kind',       'general',
    'color',      '#7FA86B',
    'emoji',      null,
    'is_default', true
  )::text;

  -- PostgREST's literal statement shape, taken from the app_events entry in
  -- your own Postgres log.
  v_sql := format($f$
    WITH pgrst_source AS (
      INSERT INTO "public"."circles"
        ("owner_id","name","kind","color","emoji","is_default")
      SELECT "pgrst_body"."owner_id","pgrst_body"."name","pgrst_body"."kind",
             "pgrst_body"."color","pgrst_body"."emoji","pgrst_body"."is_default"
      FROM (SELECT %L::json AS json_data) pgrst_payload,
      LATERAL (
        SELECT "owner_id","name","kind","color","emoji","is_default"
        FROM json_to_record(pgrst_payload.json_data)
          AS _("owner_id" uuid, "name" text, "kind" text,
               "color" text, "emoji" text, "is_default" boolean)
      ) pgrst_body
      RETURNING "public"."circles".*
    )
    SELECT pg_catalog.count(_postgrest_t) AS page_total
    FROM (SELECT * FROM pgrst_source) _postgrest_t
  $f$, v_body);

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  insert into out values ('auth.uid() resolves to', coalesce(auth.uid()::text, 'NULL'));
  insert into out values ('auth.role() resolves to', coalesce(auth.role()::text, 'NULL'));
  insert into out values ('current_user is', current_user::text);

  begin
    execute v_sql;
    perform set_config('role', 'postgres', true);
    insert into out values ('RESULT', 'SUCCEEDED, the real statement shape works');
  exception when others then
    get stacked diagnostics
      v_err   = message_text,
      v_state = returned_sqlstate,
      v_hint  = pg_exception_hint,
      v_ctx   = pg_exception_context;
    perform set_config('role', 'postgres', true);
    insert into out values ('RESULT', 'FAILED, and this is the app''s real error');
    insert into out values ('sqlstate', v_state);
    insert into out values ('error',    v_err);
    insert into out values ('hint',     coalesce(v_hint, '(none)'));
    insert into out values ('context',  coalesce(v_ctx,  '(none)'));
  end;
end $$;

select step, detail from out;

rollback;
