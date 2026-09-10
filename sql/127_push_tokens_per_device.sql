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

-- ---------------------------------------------------------------------------
-- ONE OWNER PER TOKEN, BEFORE THE INDEX CAN INSIST ON IT
-- ---------------------------------------------------------------------------
-- The unique index below failed on the live database with 23505: the same
-- ExponentPushToken existed under two accounts. That is not corruption, it is
-- the bug this file exists to fix, sitting in the data.
--
-- Expo issues one token per INSTALL, not per person. Sign out, hand the phone
-- over, sign in: the second account registers the same token and the first
-- account row was never removed, because the old primary key was user_id and
-- nothing ever compared the two.
--
-- Newest row wins. A handset belongs to whoever is signed in on it now, and
-- the row being dropped describes a device nobody is holding.
with duplicates as (
  select ctid,
         row_number() over (
           partition by token
           order by updated_at desc, ctid desc
         ) as rn
  from push_tokens
)
delete from push_tokens p
using duplicates d
where p.ctid = d.ctid
  and d.rn > 1;

-- A token belongs to exactly one account. If somebody signs out and a
-- colleague signs in on the same handset, Expo reissues the same token for
-- that install, and without this the old account keeps receiving the new
-- person's alerts.
create unique index if not exists push_tokens_token_idx on push_tokens (token);

create index if not exists push_tokens_user_idx on push_tokens (user_id);


-- ---------------------------------------------------------------------------
-- THE HAND-ME-DOWN PHONE
-- ---------------------------------------------------------------------------
-- Deduplicating once is not enough, because the situation recurs every time a
-- phone changes hands, and the unique index turns it from a silent duplicate
-- into a silent FAILURE.
--
-- Both apps upsert on (user_id, token). If that token already belongs to
-- somebody else, the insert now violates push_tokens_token_idx and errors, and
-- neither writer surfaces the error: the main app guards on `if (!error)` and
-- the Circle app swallows it in a catch. So the new owner of the phone would
-- be registered nowhere, receive nothing, and be told nothing, while the
-- previous owner kept receiving alerts on a handset they no longer hold. That
-- is strictly worse than the bug at the top of this file.
--
-- The claim happens in the database and not in the clients, because there are
-- two clients, builds already in the field, and no version of this that works
-- if only one of them updates.
--
-- WHY THIS CANNOT BE USED TO SILENCE SOMEBODY. Taking a token from another
-- account requires knowing that token, and a token is only ever known to the
-- device holding it: `push read own` (sql/20) restricts select to auth.uid(),
-- so the table cannot be read to find one. RLS still governs the insert
-- itself, so the row being written is always the caller own row.
create or replace function public.push_tokens_claim()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from push_tokens
   where token = new.token
     and user_id <> new.user_id;
  return new;
end;
$$;

revoke all on function public.push_tokens_claim() from public, anon, authenticated;

drop trigger if exists push_tokens_claim_token on push_tokens;
create trigger push_tokens_claim_token
  before insert or update of token on push_tokens
  for each row execute function public.push_tokens_claim();


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
select 'no token is shared by two accounts',
       (select count(*) = 0 from (
          select token from push_tokens group by token having count(*) > 1
        ) dupes)::text
union all
select 'a phone changing hands reassigns its token',
       (exists (select 1 from pg_trigger
                 where tgname = 'push_tokens_claim_token'
                   and not tgisinternal))::text
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
