-- Verification for sql/89, as a SELECT rather than raise notice.
--
-- The Supabase editor hides the Notices pane, so every `do $$ ... raise notice`
-- verify block in these migrations reports into a place nobody reads. This
-- returns rows instead. Read-only, safe to run any time.
select 'left_at column' as check,
       case when exists (select 1 from information_schema.columns
                         where table_name = 'sos_responders' and column_name = 'left_at')
            then 'ok' else 'MISSING' end as result
union all
select 'live responder unique index',
       case when exists (select 1 from pg_indexes where indexname = 'sos_responders_live_uq')
            then 'ok' else 'MISSING' end
union all
select 'cap trigger',
       case when exists (select 1 from pg_trigger where tgname = 'trg_sos_responder_cap')
            then 'ok' else 'MISSING' end
union all
select 'accept rpc',
       case when to_regprocedure('public.accept_sos_dispatch(text)') is not null
            then 'ok' else 'MISSING' end
union all
select 'drop rpc',
       case when to_regprocedure('public.drop_sos_dispatch(text,text)') is not null
            then 'ok' else 'MISSING' end
union all
select 'backfill column',
       case when exists (select 1 from information_schema.columns
                         where table_name = 'sos_escalation'
                           and column_name = 'backfill_requested_at')
            then 'ok' else 'MISSING' end
union all
select 'cap value', public.sos_wave_size()::text
union all
select 'SOS already over cap (want 0)',
       (select count(*)::text from (
          select sos_id from sos_responders where left_at is null
          group by sos_id having count(*) > public.sos_wave_size()
        ) x)

-- The two that matter most from the earlier migrations, re-checked here because
-- their own notices were invisible too.
union all
select 'circle_visits is INVOKER (want true)',
       coalesce((select (not prosecdef)::text from pg_proc
                 where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING')
union all
select 'circle_visits callable by clients',
       coalesce((select has_function_privilege('authenticated', oid, 'execute')::text
                 from pg_proc where oid = to_regprocedure('public.circle_visits(int)')), 'MISSING')
union all
select 'realtime authoriser honours soft delete (want true)',
       coalesce((select (prosrc like '%a.deleted_at is null%')::text
                 from pg_proc where proname = 'orbii_can_access_sos' limit 1), 'MISSING')
union all
select 'circle member cap', public.circle_member_limit()::text;
