-- users_public_replica.sql
-- ============================================================================
-- Runs the exact statement the app's users_public upsert becomes, as a real
-- authenticated user, and prints the real error.
--
-- No schema changes. Rolls back. Safe to run while anything else is going on.
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
  v_ctx   text;
begin
  if not exists (select 1 from auth.users where id = v_uid) then
    select id into v_uid from auth.users order by created_at desc limit 1;
  end if;

  insert into out values ('testing as', v_uid::text);
  insert into out values ('table-level SELECT for authenticated',
    has_table_privilege('authenticated', 'public.users_public', 'SELECT')::text);
  insert into out values ('column SELECT on username',
    has_column_privilege('authenticated', 'public.users_public', 'username', 'SELECT')::text);
  insert into out values ('column SELECT on phone (must be false)',
    has_column_privilege('authenticated', 'public.users_public', 'phone', 'SELECT')::text);

  v_body := json_build_object(
    'id',         v_uid::text,
    'username',   'replica_probe',
    'name',       'replica probe',
    'photo_url',  null,
    'phone',      null,
    'updated_at', now()::text
  )::text;

  -- PostgREST's upsert form: insert fed by json_to_record, ON CONFLICT DO
  -- UPDATE, RETURNING, wrapped in a counting SELECT.
  v_sql := format($f$
    WITH pgrst_source AS (
      INSERT INTO "public"."users_public"
        ("id","username","name","photo_url","phone","updated_at")
      SELECT "pgrst_body"."id","pgrst_body"."username","pgrst_body"."name",
             "pgrst_body"."photo_url","pgrst_body"."phone","pgrst_body"."updated_at"
      FROM (SELECT %L::json AS json_data) pgrst_payload,
      LATERAL (
        SELECT "id","username","name","photo_url","phone","updated_at"
        FROM json_to_record(pgrst_payload.json_data)
          AS _("id" uuid, "username" text, "name" text,
               "photo_url" text, "phone" text, "updated_at" timestamptz)
      ) pgrst_body
      ON CONFLICT ("id") DO UPDATE SET
        "username"   = EXCLUDED."username",
        "name"       = EXCLUDED."name",
        "photo_url"  = EXCLUDED."photo_url",
        "phone"      = EXCLUDED."phone",
        "updated_at" = EXCLUDED."updated_at"
      RETURNING 1
    )
    SELECT pg_catalog.count(_postgrest_t) AS page_total
    FROM (SELECT * FROM pgrst_source) _postgrest_t
  $f$, v_body);

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  begin
    execute v_sql;
    perform set_config('role', 'postgres', true);
    insert into out values ('RESULT', 'SUCCEEDED, so the upsert is not what is failing');
  exception when others then
    get stacked diagnostics
      v_err = message_text, v_state = returned_sqlstate, v_ctx = pg_exception_context;
    perform set_config('role', 'postgres', true);
    insert into out values ('RESULT', 'FAILED, this is the real cause');
    insert into out values ('sqlstate', v_state);
    insert into out values ('error',    v_err);
    insert into out values ('context',  coalesce(v_ctx, '(none)'));
  end;
end $$;

select step, detail from out;

rollback;
