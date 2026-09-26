-- 148_deleting_an_account_does_not_orphan_an_id_photo.sql
-- ============================================================================
-- An account deletion must not leave a photograph of somebody's Aadhaar in
-- storage with nothing left that knows where it is.
--
-- ============================================================================
-- THE LEAK
-- ============================================================================
--
-- purge-helper-docs finds images by reading `helper_documents.storage_path`.
-- That row is the ONLY record of where the file lives; Storage itself is just a
-- bucket of paths.
--
-- If `helper_documents.user_id` cascades from auth.users — which is how every
-- other helper table in this schema was built — then deleting an account
-- destroys the row and the file becomes unreachable. Not deleted. Unreachable:
-- a government ID photograph sitting in a bucket forever, with no row pointing
-- at it, invisible to the very job written to delete it.
--
-- That is the worst possible outcome of a privacy feature. The person asked to
-- be forgotten and the most sensitive thing about them is what survives.
--
-- ============================================================================
-- THE FIX, AND WHY IT NEEDS NO NEW CODE
-- ============================================================================
--
-- Drop the cascade. The row outlives the account, so the purge can still see
-- the path and delete the file.
--
-- Nothing else has to change, because purge-helper-docs already selects
-- `status in (approved, rejected) OR uploaded_at < cutoff`. A document belonging
-- to a deleted account matches the second clause within seven days whatever its
-- status, so the file goes without a new status value, without touching the
-- Edge Function, and without a deploy.
--
-- Seven days is also exactly what LEGAL_HELPER clause 2.5 already promises:
-- deleted "within 7 days of upload even if nobody has reviewed it". So this
-- lands on the published number rather than inventing a new one.
--
-- WHAT IS LEFT BEHIND, AND FOR HOW LONG. After the file is gone the row remains
-- with `storage_path = null` and `purged_at` set. It holds the verdict and the
-- document key, which is what clause 2.5 says is kept. The tidy-up below then
-- removes those rows for accounts that no longer exist, once the image is
-- confirmed gone — never before, because a row deleted while its file survives
-- recreates the exact leak this migration closes.
--
-- Idempotent. Guarded against every table being absent. No transaction control.
-- ============================================================================


do $mig$
declare
  r record;
begin
  if to_regclass('public.helper_documents') is null then
    raise notice 'helper_documents does not exist here; nothing to do';
    return;
  end if;

  -- Discovered, not assumed. This table was not created by anything in sql/,
  -- so its constraint names are unknown and guessing one would make this
  -- migration fail on the only database it matters on.
  for r in
    select c.conname
      from pg_constraint c
     where c.contype = 'f'
       and c.conrelid = to_regclass('public.helper_documents')
       and c.confrelid = to_regclass('auth.users')
  loop
    execute format('alter table public.helper_documents drop constraint %I', r.conname);
    raise notice 'dropped % on helper_documents', r.conname;
  end loop;

  comment on column public.helper_documents.user_id is
    'NOT a foreign key on purpose: the row is the only record of where the image lives, so it must outlive the account or purge-helper-docs can never delete the file (sql/148).';
end $mig$;


-- ---------------------------------------------------------------------------
-- Tidy up the rows once their image is actually gone.
--
-- Deliberately conservative on all three counts:
--   * storage_path IS NULL          the file is confirmed gone, not assumed
--   * purged_at IS NOT NULL         the purge said so, we are not guessing
--   * the auth.users row is absent  the person really did leave
--
-- Any one of those being false means the row stays. A row that stays costs a
-- few bytes; a row deleted too early costs a permanently orphaned ID photo.
-- ---------------------------------------------------------------------------
create or replace function public.purge_orphaned_helper_documents()
returns integer
language plpgsql security definer set search_path = public as $fn$
declare n int := 0;
begin
  if to_regclass('public.helper_documents') is null then return 0; end if;

  delete from helper_documents d
   where d.storage_path is null
     and d.purged_at is not null
     and not exists (select 1 from auth.users u where u.id = d.user_id);
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.purge_orphaned_helper_documents() from public, anon, authenticated;
grant execute on function public.purge_orphaned_helper_documents() to service_role;

-- 04:40, after the incident purge at 04:10 and well after the document purge at
-- 02:41, so the image is always deleted before this looks for its row.
do $mig$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('orbii-purge-orphaned-helper-docs')
      where exists (select 1 from cron.job where jobname = 'orbii-purge-orphaned-helper-docs');
    perform cron.schedule('orbii-purge-orphaned-helper-docs', '40 4 * * *',
                          'select public.purge_orphaned_helper_documents();');
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- Rows 5 to 7 reference helper_documents directly, which would fail to parse if
-- the table were absent. That is accepted here rather than guarded, because the
-- table demonstrably exists: `orbii-helper-doc-purge` is scheduled and active
-- and reads it nightly. The DDL above is still guarded, because DDL that half
-- applies is the failure this repo keeps hitting; a verify that fails loudly on
-- a database where the table is missing is fine.
-- ---------------------------------------------------------------------------
select v.check, v.result
from (
  select 0 as ord, 'helper_documents exists' as check,
         (to_regclass('public.helper_documents') is not null)::text as result

  union all
  select 1, 'it no longer cascades from auth.users (must be false)',
         exists (select 1 from pg_constraint c
                  where c.contype = 'f'
                    and c.conrelid = to_regclass('public.helper_documents')
                    and c.confrelid = to_regclass('auth.users'))::text

  union all
  select 2, 'the tidy-up exists (must be true)',
         (to_regprocedure('public.purge_orphaned_helper_documents()') is not null)::text

  union all
  select 3, 'no client can execute it (must be false)',
         has_function_privilege('authenticated',
           'public.purge_orphaned_helper_documents()', 'execute')::text

  union all
  select 4, 'it is scheduled (must be true)',
         (exists (select 1 from cron.job
                   where jobname = 'orbii-purge-orphaned-helper-docs'))::text

  union all
  -- The number that matters. Images still in storage right now, and how old the
  -- oldest one is. If the oldest exceeds 7 days, the nightly purge is failing
  -- and clause 2.5 is currently false, whatever the schedule says.
  select 5, 'images still in storage',
         (select count(*)::text from helper_documents where storage_path is not null)

  union all
  select 6, 'oldest image still in storage (must be under 7 days)',
         coalesce((select (now() - min(uploaded_at))::text
                     from helper_documents where storage_path is not null),
                  'none')

  union all
  select 7, 'rows whose owner is gone and image already deleted',
         (select count(*)::text from helper_documents d
           where d.storage_path is null
             and not exists (select 1 from auth.users u where u.id = d.user_id))
) v
order by v.ord;
