-- users_public_which_column.sql
-- ============================================================================
-- The upsert fails with "permission denied for table users_public". The fix
-- depends entirely on WHICH column privilege is missing, because one possible
-- answer is unacceptable:
--
--   granting table-level SELECT would expose `phone` to every signed-in user.
--   sql/18 removed exactly that on purpose. A readable directory of phone
--   numbers belonging to women who installed a safety app is not a trade worth
--   making to fix a profile sync.
--
-- So this establishes the minimum grant, by trying the statement four ways.
-- ON CONFLICT DO UPDATE has to read the conflicting row, so it needs SELECT on
-- the columns it touches, and the grant from sql/18 covers only
-- (id, username, name, photo_url). `updated_at` is not in that list and the
-- app writes it on every sync.
--
-- Grants are made and then rolled back. Nothing here persists.
-- ============================================================================

begin;

create temp table out (variant text, result text);
grant all on out to public;

-- The four attempts are spelled out rather than looped: each needs its own
-- exception block, and plpgsql cannot parameterise a SET list. Every attempt
-- runs as `authenticated` and restores `postgres` before the next grant.
do $$
declare
  v_uid uuid;
  v_err text;
begin
  select id into v_uid from auth.users
  where id = '8ee693c9-8324-4a5b-a1fe-6bc81f7b6426';
  if v_uid is null then
    select id into v_uid from auth.users order by created_at desc limit 1;
  end if;

  -- ---- 1. Only the four columns sql/18 granted --------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid::text, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute format($f$
      insert into public.users_public (id, username, name, photo_url)
      values (%L, 'probe_a', 'probe a', null)
      on conflict (id) do update set
        username = excluded.username, name = excluded.name,
        photo_url = excluded.photo_url
      returning 1
    $f$, v_uid);
    perform set_config('role', 'postgres', true);
    insert into out values ('1. granted columns only (id, username, name, photo_url)', 'OK');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform set_config('role', 'postgres', true);
    insert into out values ('1. granted columns only (id, username, name, photo_url)', 'FAILED: ' || v_err);
  end;

  -- ---- 2. Add updated_at, which the app always sends ---------------------
  perform set_config('role', 'authenticated', true);
  begin
    execute format($f$
      insert into public.users_public (id, username, name, photo_url, updated_at)
      values (%L, 'probe_b', 'probe b', null, now())
      on conflict (id) do update set
        username = excluded.username, name = excluded.name,
        photo_url = excluded.photo_url, updated_at = excluded.updated_at
      returning 1
    $f$, v_uid);
    perform set_config('role', 'postgres', true);
    insert into out values ('2. plus updated_at, not granted', 'OK');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform set_config('role', 'postgres', true);
    insert into out values ('2. plus updated_at, not granted', 'FAILED: ' || v_err);
  end;

  -- ---- 3. Same, after granting SELECT on updated_at only -----------------
  grant select (updated_at) on public.users_public to authenticated;
  perform set_config('role', 'authenticated', true);
  begin
    execute format($f$
      insert into public.users_public (id, username, name, photo_url, updated_at)
      values (%L, 'probe_c', 'probe c', null, now())
      on conflict (id) do update set
        username = excluded.username, name = excluded.name,
        photo_url = excluded.photo_url, updated_at = excluded.updated_at
      returning 1
    $f$, v_uid);
    perform set_config('role', 'postgres', true);
    insert into out values ('3. after grant select(updated_at)', 'OK');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform set_config('role', 'postgres', true);
    insert into out values ('3. after grant select(updated_at)', 'FAILED: ' || v_err);
  end;

  -- ---- 4. The app's real payload, phone included -------------------------
  perform set_config('role', 'authenticated', true);
  begin
    execute format($f$
      insert into public.users_public (id, username, name, photo_url, phone, updated_at)
      values (%L, 'probe_d', 'probe d', null, null, now())
      on conflict (id) do update set
        username = excluded.username, name = excluded.name,
        photo_url = excluded.photo_url, phone = excluded.phone,
        updated_at = excluded.updated_at
      returning 1
    $f$, v_uid);
    perform set_config('role', 'postgres', true);
    insert into out values ('4. the app payload, phone included', 'OK');
  exception when others then
    get stacked diagnostics v_err = message_text;
    perform set_config('role', 'postgres', true);
    insert into out values ('4. the app payload, phone included', 'FAILED: ' || v_err);
  end;
end $$;

select variant, result from out order by variant;

rollback;
