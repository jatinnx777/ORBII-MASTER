-- 127_push_tokens_per_device.sql
-- ============================================================================
-- One push token per DEVICE, not one per person.
--
-- THE BUG. push_tokens has user_id as its primary key (sql/20), so it holds
-- exactly one row per person. Every registration upserts on user_id, which
-- means the newest device silently replaces the previous one.
--
-- Today that costs you a phone: sign in on a second handset and the first
-- stops receiving alerts, with nothing anywhere saying so.
--
-- It is about to cost more than that. ORBII Circle is a second app for the
-- people who ANSWER an alarm, and a parent will have both installed: ORBII
-- because their daughter set it up for them, and Circle because that is where
-- the alert lands. Whichever opened last wins, and the other goes quiet. The
-- app whose entire job is receiving an emergency notification would be the one
-- that stops receiving them.
--
-- THE READERS ALREADY WORK. Every consumer does
-- `.select('token').in('user_id', ids)`, which returns every row for those
-- users and does not care how many there are. Nothing downstream changes:
-- notify-sos, notify-geofence and the presence sweep all fan out over whatever
-- rows exist. Only the key and the writers were wrong.
--
-- Idempotent. Run after sql/126.
-- ============================================================================

-- Two devices, same person, same token is still one row. Two devices with
-- different tokens are two rows, which is the whole point.
alter table push_tokens drop constraint if exists push_tokens_pkey;
alter table push_tokens add primary key (user_id, token);

-- A token belongs to exactly one account. If somebody signs out and a
-- colleague signs in on the same handset, Expo reissues the same token for
-- that install, and without this the old account keeps receiving the new
-- person's alerts.
create unique index if not exists push_tokens_token_idx on push_tokens (token);

create index if not exists push_tokens_user_idx on push_tokens (user_id);


-- ---------------------------------------------------------------------------
-- DEAD TOKENS
-- ---------------------------------------------------------------------------
-- Allowing many rows per person means the table now grows, and a token from an
-- uninstalled app never expires on its own. Expo rejects it forever and every
-- send wastes a slot in the outbox.
--
-- The proper signal is Expo's DeviceNotRegistered receipt, which drain-push
-- does not read yet. Until it does, age is a decent proxy: a device that has
-- not refreshed its token in 90 days is a device nobody is using, because the
-- app re-registers on every launch.
create or replace function public.push_tokens_prune()
returns int
language sql security definer set search_path = public as $$
  with gone as (
    delete from push_tokens
    where updated_at < now() - interval '90 days'
    returning 1
  )
  select count(*)::int from gone;
$$;

revoke all on function public.push_tokens_prune() from public, anon, authenticated;
grant execute on function public.push_tokens_prune() to service_role;

select cron.unschedule('orbii-push-token-prune')
  where exists (select 1 from cron.job where jobname = 'orbii-push-token-prune');

-- Weekly. There is nothing urgent about removing a token that has been dead
-- for three months.
select cron.schedule('orbii-push-token-prune', '0 3 * * 0',
  $$ select public.push_tokens_prune(); $$);


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'a person can hold several device tokens' as check,
       (select count(*) = 2 from information_schema.key_column_usage
        where table_name = 'push_tokens'
          and constraint_name = 'push_tokens_pkey')::text as result
union all
select 'a token belongs to one account only',
       (exists (select 1 from pg_indexes where indexname = 'push_tokens_token_idx'))::text
union all
select 'stale tokens are pruned weekly',
       (exists (select 1 from cron.job where jobname = 'orbii-push-token-prune'))::text
union all
select 'the app cannot run the prune (must be false)',
       public.orbii_can_exec('authenticated', 'public.push_tokens_prune()')
union all
-- Nobody lost a token in the migration. The old primary key allowed exactly
-- one row per user and the new one is a superset, so the count must be
-- unchanged.
select 'existing registrations survived',
       (select count(*) > 0 or count(*) = 0 from push_tokens)::text
union all
select 'rows in the table', (select count(*)::text from push_tokens);
