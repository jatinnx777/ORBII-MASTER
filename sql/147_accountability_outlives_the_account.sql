-- 147_accountability_outlives_the_account.sql
-- ============================================================================
-- A helper cannot delete the record that they attended an emergency.
--
-- ============================================================================
-- THE HOLE, AND WHY IT IS THE MOST SERIOUS ONE FOUND SO FAR
-- ============================================================================
--
-- LEGAL_HELPER.md clause 6.2 promises that deleting a helper account does NOT
-- remove the arrival records or the payout ledger. Clause 4.3 explains why that
-- matters: the record that a particular person attended a particular emergency
-- "protects the person who called for help, protects YOU against a false
-- accusation".
--
-- The schema does the opposite. delete_my_account() (sql/28) ends with
-- `delete from auth.users where id = uid`, and these all cascade from it:
--
--   sos_responders.user_id        on delete cascade  -- the arrival record
--   rescue_events.helper_id       on delete cascade  -- accept, arrive, depart
--   rescue_events.victim_id       on delete cascade
--   coin_transactions.user_id     on delete cascade  -- the 8-year tax ledger
--   sos_arrival_codes.assignee_id on delete cascade  -- proof of arrival
--
-- So the accountability the entire responder network rests on can be erased, at
-- will, by the one person with a motive to erase it. And it is not theoretical:
-- both apps point at the same Supabase project and the same auth.users, so a
-- helper who does not want an arrival on record installs the main ORBII app,
-- signs in with the same email, taps Delete my account, and it is gone. The
-- Helper app does not even need a delete button for this to work, and it does
-- not have one.
--
-- ============================================================================
-- THE FIX, AND WHY IT IS A DROPPED CONSTRAINT RATHER THAN SET NULL
-- ============================================================================
--
-- `on delete set null` would keep the row and throw away which person it was,
-- which defeats the purpose: a record that somebody attended, with no somebody,
-- protects nobody and exonerates nobody.
--
-- So the foreign key is dropped and the uuid column is kept and stays NOT NULL.
-- The row survives the account with the identifier intact. This is deliberately
-- a weaker database guarantee in exchange for the record surviving, and the
-- trade is the right way round: a dangling uuid is a small cost, and these
-- tables are already written only by SECURITY DEFINER functions that resolve
-- the user from the JWT, so nothing was relying on the FK to validate input.
--
-- sos_responders already stores `name` alongside the id, so the surviving row
-- still says WHO attended in words, not just as a uuid. That is what the
-- incident policy actually needs at 2am.
--
-- ============================================================================
-- WHAT IS DELIBERATELY NOT CHANGED
-- ============================================================================
--
-- helper_profiles still goes. Clause 6.1 promises the profile and the identity
-- documents are removed on deletion, and that promise should be kept. The name
-- on the arrival record carries the accountability without keeping a
-- verification file on somebody who left.
--
-- sos_events still goes when the person who raised it deletes her account. Her
-- right to erasure is stronger than our convenience, and the arrival record
-- survives independently now, so deleting the emergency no longer destroys the
-- proof that a helper attended it.
--
-- helper_dispatches is left cascading. It records who was ASKED, not who came,
-- it is unreadable by any client, and it is purged with the emergency at three
-- years anyway. Being asked to help is not a thing anybody needs held against
-- them after they have left.
--
-- ============================================================================
-- Idempotent. Constraint names are discovered rather than assumed, because
-- these tables were created across sql/31, 33, 51 and 56 and nothing guarantees
-- Postgres named them the way this file would guess.
-- ============================================================================


-- to_regclass rather than ::regclass throughout: ::regclass RAISES on a table
-- that does not exist, which would abort this migration part-way and leave the
-- schema in a state nobody wrote down. These tables span sql/31 to sql/56 and
-- this repo has no applied-migration ledger, so "it must be there" is an
-- assumption, not a fact.
do $mig$
declare
  r record;
begin
  for r in
    select c.conname,
           c.conrelid::regclass::text as tbl
      from pg_constraint c
      join pg_attribute a
        on a.attrelid = c.conrelid
       and a.attnum = any (c.conkey)
     where c.contype = 'f'
       and c.confrelid = to_regclass('auth.users')
       and c.conrelid in (
             coalesce(to_regclass('public.sos_responders'),    0::oid),
             coalesce(to_regclass('public.rescue_events'),     0::oid),
             coalesce(to_regclass('public.coin_transactions'), 0::oid),
             coalesce(to_regclass('public.sos_arrival_codes'), 0::oid))
       and a.attname in ('user_id', 'helper_id', 'victim_id', 'assignee_id')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    raise notice 'dropped % on %', r.conname, r.tbl;
  end loop;
end $mig$;


-- The FK was also the thing that gave these columns an index on some of these
-- tables. Queries that filter by helper still need one, and a missing index
-- here would show up as a slow dispatcher rather than as an error.
--
-- Guarded the same way as the block above, and for the same reason: a bare
-- CREATE INDEX on an absent table raises and takes the migration with it.
do $mig$
begin
  if to_regclass('public.sos_responders') is not null then
    create index if not exists sos_responders_user_idx
      on public.sos_responders (user_id);
    comment on column public.sos_responders.user_id is
      'The helper who attended. NOT a foreign key on purpose: the arrival record must outlive the account (sql/147, LEGAL_HELPER clause 6.2).';
  end if;

  if to_regclass('public.rescue_events') is not null then
    create index if not exists rescue_events_helper_idx
      on public.rescue_events (helper_id);
  end if;

  if to_regclass('public.coin_transactions') is not null then
    create index if not exists coin_tx_user_only_idx
      on public.coin_transactions (user_id);
    comment on column public.coin_transactions.user_id is
      'NOT a foreign key on purpose: the payout ledger is kept 8 years for the Income-tax Act and must outlive the account (sql/147).';
  end if;
end $mig$;


-- ---------------------------------------------------------------------------
-- delete_my_account() is left alone, with one exception.
--
-- It does not need to change to get the behaviour above; the constraints were
-- doing the damage, not the function. But it currently says nothing about the
-- helper tables that sql/28 predates, so it would leave a deleted helper's
-- duty row publishing into the dispatch pool. A helper who leaves must stop
-- being dispatchable immediately, and that is a safety bug, not a privacy one.
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not signed in'; end if;

  -- Stop being dispatchable BEFORE anything else. If the rest of this function
  -- fails half way, the one outcome that must still hold is that no emergency
  -- is sent to somebody who has left.
  begin delete from helpers_live      where user_id = uid; exception when undefined_table then null; end;
  begin delete from push_tokens       where user_id = uid; exception when undefined_table then null; end;

  delete from helper_earnings   where user_id = uid;
  delete from payout_requests   where user_id = uid;
  delete from helper_profiles   where user_id = uid;
  delete from sos_events        where user_id = uid;
  begin delete from emergency_contacts where user_id = uid; exception when undefined_table then null; end;
  begin delete from entitlements       where user_id = uid; exception when undefined_table then null; end;
  begin delete from users_public       where id = uid;      exception when undefined_table then null; end;
  delete from profiles          where id = uid;

  -- Full auth removal (best-effort; if blocked, all personal data is already
  -- gone). As of sql/147 this no longer takes the arrival records or the coin
  -- ledger with it.
  begin delete from auth.users where id = uid; exception when others then null; end;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
--
-- The first four must all be false. A `true` there means the arrival record or
-- the tax ledger still dies with the account, and clause 6.2 is still a lie.
-- ---------------------------------------------------------------------------
select v.check, v.result
from (
  -- FIRST, because every "must be false" below would also read false for a
  -- table that does not exist. If this row is not 'all four present', the
  -- passes underneath it mean nothing.
  select 0 as ord,
         'the four accountability tables exist' as check,
         (case when to_regclass('public.sos_responders') is not null
                and to_regclass('public.rescue_events') is not null
                and to_regclass('public.coin_transactions') is not null
                and to_regclass('public.sos_arrival_codes') is not null
               then 'all four present'
               else 'MISSING: '
                 || concat_ws(', ',
                      case when to_regclass('public.sos_responders')    is null then 'sos_responders' end,
                      case when to_regclass('public.rescue_events')     is null then 'rescue_events' end,
                      case when to_regclass('public.coin_transactions') is null then 'coin_transactions' end,
                      case when to_regclass('public.sos_arrival_codes') is null then 'sos_arrival_codes' end)
          end) as result

  union all
  select 1,
         'sos_responders still cascades from auth.users (must be false)',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.sos_responders')
                    and c.confrelid = to_regclass('auth.users')
                    and c.contype = 'f')::text as result

  union all
  select 2, 'rescue_events still cascades from auth.users (must be false)',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.rescue_events')
                    and c.confrelid = to_regclass('auth.users')
                    and c.contype = 'f')::text

  union all
  select 3, 'coin_transactions still cascades from auth.users (must be false)',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.coin_transactions')
                    and c.confrelid = to_regclass('auth.users')
                    and c.contype = 'f')::text

  union all
  select 4, 'sos_arrival_codes.assignee_id still cascades (must be false)',
         exists (select 1 from pg_constraint c
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                  where c.conrelid = to_regclass('public.sos_arrival_codes')
                    and c.confrelid = to_regclass('auth.users')
                    and c.contype = 'f'
                    and a.attname = 'assignee_id')::text

  union all
  -- The identifier must still be there. A surviving row with a null helper
  -- would be the set-null outcome this migration exists to avoid.
  select 5, 'sos_responders.user_id is still NOT NULL (must be true)',
         (select a.attnotnull::text from pg_attribute a
           where a.attrelid = to_regclass('public.sos_responders')
             and a.attname = 'user_id')

  union all
  select 6, 'sos_responders still records the name in words (must be true)',
         exists (select 1 from pg_attribute a
                  where a.attrelid = to_regclass('public.sos_responders')
                    and a.attname = 'name' and a.attnum > 0)::text

  union all
  select 7, 'deleting an account stops duty publishing (must be true)',
         (select (pg_get_functiondef(oid) like '%helpers_live%')::text
            from pg_proc
           where proname = 'delete_my_account' and pronamespace = 'public'::regnamespace)

  union all
  select 8, 'sos_events still cascades to arrival codes at 3 years (must be true)',
         exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.sos_arrival_codes')
                    and c.confrelid = to_regclass('public.sos_events')
                    and c.contype = 'f'
                    and c.confdeltype = 'c')::text

  union all
  select 9, 'arrival records on file right now',
         (select count(*)::text from sos_responders)
) v
order by v.ord;
