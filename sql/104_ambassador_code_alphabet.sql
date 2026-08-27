-- 104_ambassador_code_alphabet.sql
-- ============================================================================
-- The code alphabet banned O and I. That was wrong, and the first insert proved
-- it by rejecting ORBII01.
--
-- WHAT I WAS SOLVING. Somebody reading a code off a poster in a corridor can
-- confuse O with 0 and I with 1. Removing the letters removes the ambiguity.
--
-- WHY IT WAS THE WRONG TRADE. It also removes most of the words anybody would
-- actually want to use. ORBII01, DELHI01, NOIDA02, SONIPAT01 are all rejected.
-- A rule that forbids your own brand name and three of the cities you are
-- launching in is not protecting anybody; it is just going to be worked around
-- with worse codes.
--
-- The ambiguity it prevents costs a person one retry. The rule costs every code
-- forever. Full A to Z and 0 to 9 now.
--
-- The real protection against a mistyped code was never the alphabet: it is
-- that a wrong code binds nothing and shows nothing, so the user is not harmed
-- and the ambassador can just tell them again.
--
-- Idempotent. Run after sql/103.
-- ============================================================================

alter table ambassadors drop constraint if exists ambassadors_code_check;

alter table ambassadors
  add constraint ambassadors_code_check
  check (code ~ '^[A-Z0-9]{4,12}$');

-- The admin helper carried its own copy of the same regex. Two copies of a rule
-- is two places to forget, so it now asks the table what is legal by simply
-- attempting the insert and letting the constraint speak.
create or replace function public.admin_add_ambassador(
  p_email   text,
  p_code    text,
  p_college text,
  p_term    text default '2026-autumn'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid;
  norm text;
begin
  if not public.is_admin() then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  norm := upper(btrim(coalesce(p_code, '')));

  if norm !~ '^[A-Z0-9]{4,12}$' then
    return jsonb_build_object('ok', false,
      'message', 'Code must be 4 to 12 letters or numbers, no spaces or symbols.');
  end if;

  select u.id into uid
  from auth.users u
  where lower(u.email) = lower(btrim(coalesce(p_email, '')));

  if uid is null then
    return jsonb_build_object('ok', false,
      'message', 'No ORBII account with that email. They have to sign up in the app first.');
  end if;

  if exists (select 1 from ambassadors where upper(code) = norm) then
    return jsonb_build_object('ok', false, 'message', 'That code is already taken.');
  end if;

  if exists (select 1 from ambassadors where user_id = uid and term = p_term) then
    return jsonb_build_object('ok', false,
      'message', 'That person is already an ambassador this term.');
  end if;

  insert into ambassadors (user_id, code, college, term)
  values (uid, norm, btrim(p_college), p_term);

  return jsonb_build_object('ok', true, 'code', norm,
    'message', 'Added. Send them orbii.in/ambassador.');
end $$;

revoke all on function public.admin_add_ambassador(text, text, text, text) from public, anon;
grant execute on function public.admin_add_ambassador(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The founder, retried now the alphabet allows it
-- ---------------------------------------------------------------------------
do $$
declare
  uid uuid;
begin
  select id into uid from auth.users where lower(email) = 'jaykumar2470f@gmail.com';
  if uid is null then
    raise notice 'No account for jaykumar2470f@gmail.com. Sign in once, then re-run.';
  elsif exists (select 1 from ambassadors where user_id = uid and term = '2026-autumn') then
    raise notice 'Already an ambassador this term.';
  else
    insert into ambassadors (user_id, code, college, term)
    values (uid, 'ORBII01', 'SRM University Sonepat', '2026-autumn');
    raise notice 'Added as ORBII01.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'ORBII01 is now a legal code' as check,
       ('ORBII01' ~ '^[A-Z0-9]{4,12}$')::text as result
union all
select 'DELHI01 is now a legal code', ('DELHI01' ~ '^[A-Z0-9]{4,12}$')::text
union all
select 'lowercase still rejected', (not ('srms01' ~ '^[A-Z0-9]{4,12}$'))::text
union all
select 'symbols still rejected', (not ('SRMS-01' ~ '^[A-Z0-9]{4,12}$'))::text
union all
select 'founder is an ambassador',
       (exists (select 1 from ambassadors a join auth.users u on u.id = a.user_id
                where lower(u.email) = 'jaykumar2470f@gmail.com'))::text
union all
select 'your code',
       coalesce((select a.code from ambassadors a join auth.users u on u.id = a.user_id
                 where lower(u.email) = 'jaykumar2470f@gmail.com' limit 1), 'NOT SET');
