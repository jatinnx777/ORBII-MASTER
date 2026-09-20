-- 142_owned_circle_limit.sql
-- ============================================================================
-- The owned-circle limit moves to the server. Free goes from 1 to 2.
--
-- WHAT IT WAS. FREE_CIRCLE_LIMIT = 1 in src/services/entitlements.ts, checked
-- in CirclesScreen before navigating. That is a prompt, not a limit: anything
-- that talks to PostgREST directly ignores it entirely.
--
-- THE RISK THIS CARRIES, AND WHY IT IS BUILT THE WAY IT IS.
--
-- A server-side paywall that reads premium wrongly does not inconvenience
-- somebody, it locks a paying user out of a safety feature. So this was only
-- written after confirming the source is real:
--
--   * public.entitlements is written by the verify-payment Edge Function,
--     server side, after a verified Razorpay payment. The client cannot write
--     it.
--   * The app's profile.isPremium is hydrated FROM that table, so the server
--     and the client are reading the same fact rather than two that can drift.
--   * 5 rows exist today, all premium_enabled = true, none null.
--
-- MISSING ROW MEANS FREE, NOT BLOCKED. Almost every user has no entitlements
-- row at all, which is the normal state of a free account. The check below
-- treats absence as free and still allows two circles, so a person with no row
-- is never worse off than they are today.
--
-- FAILING OPEN, DELIBERATELY. If the entitlements read errors for any reason,
-- the insert is allowed. On a safety product the cost of wrongly allowing a
-- third circle is nothing; the cost of wrongly refusing one is that somebody
-- cannot set up the group that would be told she is in trouble. Those are not
-- comparable, so the tie is not broken in the paywall's favour.
--
-- NO COUNTER COLUMN. A direct count of a handful of rows on an indexed column
-- is cheaper than the correctness problem a denormalised counter creates the
-- first time a delete races an insert.
--
-- Idempotent.
-- ============================================================================

create or replace function public.orbii_is_premium(p_uid uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v boolean;
begin
  select e.premium_enabled into v
  from entitlements e
  where e.user_id = p_uid;
  -- Null covers both "no row" (a free account) and "row with a null flag".
  return coalesce(v, false);
exception when others then
  -- See the header: this failing must not cost somebody a circle.
  return true;
end $$;

comment on function public.orbii_is_premium(uuid) is
  'Server-side premium check, read from entitlements, which only the verify-payment Edge Function writes. Returns true on error so a broken read can never lock a paying user out.';

revoke all on function public.orbii_is_premium(uuid) from public, anon;
grant execute on function public.orbii_is_premium(uuid) to authenticated, service_role;


create or replace function public.free_owned_circle_limit()
returns int language sql immutable as $$ select 2 $$;

comment on function public.free_owned_circle_limit() is
  'Circles a free account may OWN. Being in somebody else''s circle is unlimited and always free.';


-- ---------------------------------------------------------------------------
-- THE TRIGGER
--
-- BEFORE INSERT on circles, counting only circles this person owns. Joining is
-- untouched and stays unlimited: nobody should ever be unable to accept an
-- invitation to a circle that would be told she needs help.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_owned_circle_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n   int;
  cap int := public.free_owned_circle_limit();
begin
  if public.orbii_is_premium(new.owner_id) then
    return new;
  end if;

  select count(*) into n from circles where owner_id = new.owner_id;

  if n >= cap then
    -- The client surfaces raw Postgres text, so a real person reads this.
    raise exception
      'You can create % circles on the free plan. Being in someone else''s circle is always free and unlimited.',
      cap
      using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_owned_circle_limit on public.circles;
create trigger trg_owned_circle_limit
  before insert on public.circles
  for each row execute function public.enforce_owned_circle_limit();


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'free accounts may own 2' as check,
       (public.free_owned_circle_limit() = 2)::text as result
union all
select 'the trigger is installed',
       (exists (select 1 from pg_trigger
                where tgname = 'trg_owned_circle_limit' and not tgisinternal))::text
union all
select 'premium reads from entitlements',
       (pg_get_functiondef(
          (select oid from pg_proc where proname = 'orbii_is_premium'
             and pronamespace = 'public'::regnamespace limit 1)
        ) ~ 'entitlements')::text
union all
select 'a user with no entitlements row reads as free (must be false)',
       public.orbii_is_premium('00000000-0000-0000-0000-000000000000'::uuid)::text
union all
select 'every paying account still reads as premium (must be true)',
       coalesce((select bool_and(public.orbii_is_premium(user_id))::text
                 from entitlements where premium_enabled), 'no paying accounts yet')
union all
select 'accounts that would now be over the limit',
       (select count(*)::text from (
          select owner_id from circles group by owner_id
          having count(*) > public.free_owned_circle_limit()
        ) x)
union all
select 'anon cannot read premium status (must be false)',
       has_function_privilege('anon', 'public.orbii_is_premium(uuid)', 'execute')::text;
