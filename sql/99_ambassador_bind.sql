-- 99_ambassador_bind.sql
-- ============================================================================
-- Bind a signing-up user to the ambassador who referred them.
--
-- sql/97 built the tables and the ledger but nothing that WRITES a referral, so
-- the whole programme has been a schema with no input. This is the input.
--
-- CALLED AFTER THE ACCOUNT EXISTS, never before. The user is already signed in
-- when this runs, so auth.uid() is the person being referred and nothing has to
-- be trusted from the client except the code itself.
--
-- IT MUST NEVER BLOCK SIGNUP. Every failure path returns ok:false with a reason
-- and the caller ignores it. Somebody typing a code wrong, or an ambassador
-- being removed mid-term, must not stop a woman finishing setup on a safety app.
--
-- Idempotent. Run after sql/98.
-- ============================================================================

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
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  -- Normalise before matching. The code is typed by a person, often from a
  -- poster on a wall, so leading spaces and lowercase are the norm rather than
  -- the exception.
  norm := upper(btrim(coalesce(p_code, '')));
  if norm = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;

  select a.* into amb
  from ambassadors a
  where upper(a.code) = norm and a.status = 'active';

  if not found then
    -- Deliberately not an error. A wrong code is a typo, not a fault, and the
    -- client shows nothing.
    return jsonb_build_object('ok', false, 'reason', 'unknown_code');
  end if;

  -- An ambassador cannot refer themselves. Cheap to check, and the first thing
  -- anybody tries.
  if amb.user_id = uid then
    return jsonb_build_object('ok', false, 'reason', 'self_referral');
  end if;

  -- One referral per user, ever, enforced by the partial unique index in
  -- sql/97. Checked here first so the common case returns a sentence instead of
  -- a constraint violation.
  if exists (select 1 from ambassador_referrals where referred_user = uid) then
    return jsonb_build_object('ok', false, 'reason', 'already_referred');
  end if;

  insert into ambassador_referrals (ambassador_id, referred_user, source, device_hash)
  values (
    amb.id,
    uid,
    case when p_source in ('deep_link', 'signup_code', 'manual')
         then p_source else 'signup_code' end,
    nullif(btrim(coalesce(p_device_hash, '')), '')
  )
  on conflict do nothing;

  -- No ledger credit here. Activation is a separate, later decision made by
  -- ambassador_activation_sweep once the phone is verified, an emergency
  -- contact exists, and 24 hours have passed. Crediting at signup would pay for
  -- an account that gets deleted an hour later.
  return jsonb_build_object('ok', true, 'college', amb.college);
end $$;

revoke all on function public.ambassador_bind_referral(text, text, text) from public, anon;
grant execute on function public.ambassador_bind_referral(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Is this a real code? Used to show a tick next to the field as it is typed.
-- ---------------------------------------------------------------------------
-- Returns the college and nothing else. Never the ambassador's name or user id:
-- a stranger should not be able to enumerate who our ambassadors are by trying
-- codes, and the college alone is enough for the user to recognise a mistake.
create or replace function public.ambassador_code_exists(p_code text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select jsonb_build_object('valid', true, 'college', a.college)
     from ambassadors a
     where upper(a.code) = upper(btrim(coalesce(p_code, '')))
       and a.status = 'active'
     limit 1),
    jsonb_build_object('valid', false)
  );
$$;

revoke all on function public.ambassador_code_exists(text) from public, anon;
grant execute on function public.ambassador_code_exists(text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'bind rpc' as check,
       (to_regprocedure('public.ambassador_bind_referral(text,text,text)') is not null)::text as result
union all
select 'code check rpc',
       (to_regprocedure('public.ambassador_code_exists(text)') is not null)::text
union all
select 'anon cannot bind',
       (not has_function_privilege('anon',
         'public.ambassador_bind_referral(text,text,text)', 'execute'))::text;
