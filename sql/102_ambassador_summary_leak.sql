-- 102_ambassador_summary_leak.sql
-- ============================================================================
-- ambassador_summary lets any signed-in user read any ambassador's earnings.
--
-- FOUND WHILE RE-READING IT FOR A PUBLIC DASHBOARD. sql/97 wrote this:
--
--   where (p_ambassador is not null and a.id = p_ambassador)
--      or (p_ambassador is null and a.user_id = auth.uid())
--
-- The parameter was meant for admin tooling. What it actually does is skip the
-- auth.uid() check entirely: pass any ambassador id and the function returns
-- that person's code, college, active user count, total earned, cleared balance
-- and what they have been paid. SECURITY DEFINER, granted to `authenticated`.
--
-- It has been latent because nothing calls it with an argument. It stops being
-- latent the moment an ambassador dashboard ships on the website, where the
-- anon key sits in the page source and any ambassador can open devtools and
-- read every other ambassador's earnings by iterating ids.
--
-- Same class of bug as circle_visits in sql/86: a DEFINER function whose caller
-- predicate had a hole in it. Second time. The lesson is that a DEFINER
-- function with an id parameter needs the ownership check written as a separate
-- statement, not folded into an OR that can be short-circuited.
--
-- Idempotent. Run after sql/101.
-- ============================================================================

drop function if exists public.ambassador_summary(uuid);

create or replace function public.ambassador_summary(p_ambassador uuid default null)
returns table (
  ambassador_id       uuid,
  code                text,
  college             text,
  active_user_count   int,
  pending_count       int,
  total_earned_paise  bigint,
  cleared_paise       bigint,
  paid_paise          bigint,
  unpaid_balance_paise bigint,
  next_milestone      int,
  can_withdraw        boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  -- Resolve WHO we are allowed to look at, before touching any money.
  -- Written as its own statement rather than a clause inside the query, because
  -- the version this replaces hid the authorisation inside an OR and the OR was
  -- satisfiable without it.
  if p_ambassador is null then
    select a.id into target from ambassadors a where a.user_id = auth.uid();
  elsif public.is_admin() then
    target := p_ambassador;
  else
    -- An id was passed by somebody who is not an admin. Allowed only if it is
    -- their own row.
    select a.id into target
    from ambassadors a
    where a.id = p_ambassador and a.user_id = auth.uid();
  end if;

  if target is null then
    return;  -- no rows, not an error. Not being an ambassador is normal.
  end if;

  return query
  with counts as (
    select
      count(*) filter (where r.activated_at is not null and r.rejected_at is null)::int as active,
      count(*) filter (where r.activated_at is null and r.rejected_at is null)::int as pending
    from ambassador_referrals r
    where r.ambassador_id = target
  ),
  money as (
    select
      coalesce(sum(l.paise) filter (where l.state <> 'reversed'), 0)::bigint as earned,
      coalesce(sum(l.paise) filter (where l.state = 'cleared'), 0)::bigint as cleared
    from ambassador_ledger l
    where l.ambassador_id = target
  ),
  paid as (
    select coalesce(sum(p.paise) filter (where p.state <> 'rejected'), 0)::bigint as out
    from ambassador_payouts p
    where p.ambassador_id = target
  )
  select
    a.id,
    a.code,
    a.college,
    c.active,
    c.pending,
    mo.earned,
    mo.cleared,
    pd.out,
    greatest(0, mo.cleared - pd.out),
    (select min(ms.users) from public.amb_milestones() ms where ms.users > c.active),
    greatest(0, mo.cleared - pd.out) >= public.amb_min_withdrawal_paise()
  from ambassadors a
  cross join counts c
  cross join money mo
  cross join paid pd
  where a.id = target;
end $$;

revoke all on function public.ambassador_summary(uuid) from public, anon;
grant execute on function public.ambassador_summary(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- WHAT THE DASHBOARD IS ALLOWED TO SHOW
-- ---------------------------------------------------------------------------
-- Recent credits, so an ambassador can see WHY a number moved rather than
-- having to trust it. Their own rows only, and never anything identifying the
-- person referred: no name, no email, no user id. An ambassador knowing exactly
-- which of their friends installed a women's safety app is the thing this whole
-- schema has been careful about since sql/97.
create or replace function public.ambassador_recent_activity(p_limit int default 20)
returns table (
  happened_at timestamptz,
  kind        text,
  paise       int,
  state       text,
  note        text
)
language sql
stable
security definer
set search_path = public
as $$
  select l.created_at, l.kind, l.paise, l.state, l.note
  from ambassador_ledger l
  join ambassadors a on a.id = l.ambassador_id
  where a.user_id = auth.uid()
  order by l.created_at desc
  limit greatest(1, least(p_limit, 100));
$$;

revoke all on function public.ambassador_recent_activity(int) from public, anon;
grant execute on function public.ambassador_recent_activity(int) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'summary rpc present' as check,
       (to_regprocedure('public.ambassador_summary(uuid)') is not null)::text as result
union all
-- The regression guard. If the old OR pattern ever comes back, this goes false.
select 'summary checks ownership separately (must be true)',
       (coalesce((select prosrc from pg_proc where proname = 'ambassador_summary')
                 like '%a.id = p_ambassador and a.user_id = auth.uid()%', false))::text
union all
select 'recent activity rpc',
       (to_regprocedure('public.ambassador_recent_activity(int)') is not null)::text
union all
select 'anon cannot read summaries',
       (not has_function_privilege('anon', 'public.ambassador_summary(uuid)', 'execute'))::text;
