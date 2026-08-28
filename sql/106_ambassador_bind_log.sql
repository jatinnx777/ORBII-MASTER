-- 106_ambassador_bind_log.sql
-- ============================================================================
-- Record every bind attempt and why it did or did not work.
--
-- WHY THIS EXISTS. A referral was typed correctly, against a valid active code,
-- from an account that is not the ambassador's, with the rpc present and
-- callable, and no row appeared in ambassador_referrals. Every check on the
-- database side passed and the table stayed empty, and there was no way to tell
-- whether the client had even called the function.
--
-- That took hours to not answer. With forty ambassadors it would be the whole
-- support load, because bindReferral deliberately swallows every outcome so a
-- marketing code can never sit between a woman and the end of setup. That is
-- the right call for her and it leaves nobody able to debug it.
--
-- So the server writes down what it was asked and what it decided. If a row
-- appears here, the client called and the database refused, and the reason is
-- in the row. If nothing appears, the call never arrived and the bug is on the
-- phone. Either way the next question takes five seconds instead of an evening.
--
-- Idempotent. Run after sql/105.
-- ============================================================================

create table if not exists ambassador_bind_attempts (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  user_id     uuid references auth.users(id) on delete set null,
  code        text,
  source      text,
  outcome     text not null,
  device_hash text
);

create index if not exists ambassador_bind_attempts_at_idx
  on ambassador_bind_attempts (at desc);

-- Nobody reads this directly. It is written by a SECURITY DEFINER function and
-- read through an admin-gated one, so RLS with no policy is the correct state:
-- deny everything, and let the definer functions be the only doors.
alter table ambassador_bind_attempts enable row level security;
revoke all on ambassador_bind_attempts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- THE SAME FUNCTION, NOW WITH A DIARY
-- ---------------------------------------------------------------------------
-- Every decision in sql/99 is preserved exactly. The only change is that each
-- return path writes a row first. The logging must never be able to break the
-- bind, so it is a plain insert into a table with no constraints to violate.
create or replace function public.ambassador_bind_referral(
  p_code        text,
  p_source      text default 'signup_code',
  p_device_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  amb   record;
  norm  text;
  hash  text := nullif(btrim(coalesce(p_device_hash, '')), '');
begin
  norm := upper(btrim(coalesce(p_code, '')));

  if uid is null then
    insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
    values (null, norm, p_source, 'not_signed_in', hash);
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  if norm = '' then
    insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
    values (uid, norm, p_source, 'empty', hash);
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select a.* into amb
  from ambassadors a
  where upper(a.code) = norm and a.status = 'active';

  if not found then
    -- Still not an error to the caller. A wrong code is a typo, not a fault.
    insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
    values (uid, norm, p_source, 'unknown_code', hash);
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;

  if amb.user_id = uid then
    insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
    values (uid, norm, p_source, 'self_referral', hash);
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  if exists (select 1 from ambassador_referrals where referred_user = uid) then
    insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
    values (uid, norm, p_source, 'already_referred', hash);
    return jsonb_build_object('ok', false, 'reason', 'already_referred');
  end if;

  insert into ambassador_referrals (ambassador_id, referred_user, source, device_hash)
  values (
    amb.id,
    uid,
    case when p_source in ('deep_link', 'signup_code', 'manual')
         then p_source else 'signup_code' end,
    hash
  )
  on conflict do nothing;

  insert into ambassador_bind_attempts (user_id, code, source, outcome, device_hash)
  values (uid, norm, p_source, 'bound', hash);

  -- No ledger credit here. Activation is a separate, later decision made by
  -- ambassador_activation_sweep once identity is verified, an emergency contact
  -- exists, a corroborating circle member exists, and 24 hours have passed.
  return jsonb_build_object('ok', true, 'college', amb.college);
end $$;

revoke all on function public.ambassador_bind_referral(text, text, text) from public, anon;
grant execute on function public.ambassador_bind_referral(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- READ IT FROM /admin
-- ---------------------------------------------------------------------------
-- Admin gated as its own first statement, the shape sql/102 had to be rewritten
-- to use. Emails are included deliberately: this is a debugging tool for the
-- founder, it is never exposed to an ambassador, and without the address it
-- cannot answer "did MY signup bind".
create or replace function public.admin_bind_attempts(p_limit int default 50)
returns table (
  at      timestamptz,
  email   text,
  code    text,
  source  text,
  outcome text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return query
  select b.at, u.email::text, b.code, b.source, b.outcome
  from ambassador_bind_attempts b
  left join auth.users u on u.id = b.user_id
  order by b.at desc
  limit greatest(1, least(p_limit, 200));
end $$;

revoke all on function public.admin_bind_attempts(int) from public, anon;
grant execute on function public.admin_bind_attempts(int) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'attempt log table' as check,
       (to_regclass('public.ambassador_bind_attempts') is not null)::text as result
union all
select 'bind rpc still present',
       (to_regprocedure('public.ambassador_bind_referral(text,text,text)') is not null)::text
union all
select 'bind rpc now logs (must be true)',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_bind_referral')
                 like '%ambassador_bind_attempts%', false))::text
union all
select 'signed-in users may still call it',
       has_function_privilege('authenticated',
         'public.ambassador_bind_referral(text,text,text)', 'execute')::text
union all
select 'admin reader',
       (to_regprocedure('public.admin_bind_attempts(int)') is not null)::text
union all
select 'attempts recorded so far',
       (select count(*)::text from ambassador_bind_attempts)
union all
select 'referral rows',
       (select count(*)::text from ambassador_referrals);
