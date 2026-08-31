-- 109_escalation_claims.sql
-- ============================================================================
-- "SOS sent" is not "help is coming". This is the stage that closes that gap.
--
-- WHAT WAS WRONG. At 90 seconds with nobody accepted, ORBII asked HER to call
-- 112. She is the person least able to make a phone call: she may be hiding,
-- restrained, unable to speak, or holding a phone she dare not look at. The
-- pipeline reached its most critical moment and handed the work back to the one
-- person who cannot do it.
--
-- The escalation belongs with the people who CAN act. So the circle is told
-- nobody has accepted, and one of them calls.
--
-- AND THE BYSTANDER PROBLEM. Four people each seeing "somebody should call 112"
-- is four people assuming somebody else did. That is not a hypothetical, it is
-- the best documented failure in emergency response, and software makes it
-- worse by showing everyone the same screen at the same instant.
--
-- So calling is CLAIMED, out loud, and everyone sees who claimed it. One person
-- is doing it and the other three know they are not, which is the entire point
-- of this file.
--
-- Idempotent. Run after sql/108.
-- ============================================================================

create table if not exists sos_escalations (
  id         bigserial primary key,
  sos_id     text not null references sos_events(id) on delete cascade,
  claimed_by uuid not null references auth.users(id) on delete cascade,
  -- Deliberately not free text. A claim is a commitment somebody else relies
  -- on, so the set of things you can promise is fixed and readable.
  action     text not null check (action in ('calling_112', 'going_there', 'reached')),
  at         timestamptz not null default now(),
  released_at timestamptz,
  unique (sos_id, claimed_by, action)
);

create index if not exists sos_escalations_sos_idx on sos_escalations (sos_id, at desc);

alter table sos_escalations enable row level security;
revoke all on sos_escalations from anon, authenticated;

-- ---------------------------------------------------------------------------
-- CLAIM IT
-- ---------------------------------------------------------------------------
-- Anyone who can see the SOS can claim. Deliberately NOT restricted to verified
-- responders: the person most likely to call 112 is her mother, and a
-- permission check that stopped her would be the worst possible use of one.
create or replace function public.claim_sos_escalation(p_sos text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  taker text;
begin
  if p_action not in ('calling_112', 'going_there', 'reached') then
    return jsonb_build_object('ok', false, 'message', 'Unknown action.');
  end if;

  if not public.orbii_can_access_sos(p_sos) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  -- Already claimed by someone else? Say who, rather than silently taking it.
  -- Two people calling 112 is harmless; two people BELIEVING they are the only
  -- one is not, and the fix for both is telling everyone the truth.
  select coalesce(u.name, 'Someone')::text into taker
  from sos_escalations e
  left join users_public u on u.id = e.claimed_by
  where e.sos_id = p_sos
    and e.action = p_action
    and e.released_at is null
    and e.claimed_by <> auth.uid()
  order by e.at
  limit 1;

  insert into sos_escalations (sos_id, claimed_by, action)
  values (p_sos, auth.uid(), p_action)
  on conflict (sos_id, claimed_by, action) do update set released_at = null, at = now();

  return jsonb_build_object('ok', true, 'also', taker);
end $$;

revoke all on function public.claim_sos_escalation(text, text) from public, anon;
grant execute on function public.claim_sos_escalation(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- LET IT GO
-- ---------------------------------------------------------------------------
-- Somebody who said they would call and then could not MUST be able to take it
-- back, or the claim becomes a lie that stops anyone else acting. Releasing has
-- to be as easy as claiming, and it is the reason this is a claim rather than a
-- log.
create or replace function public.release_sos_escalation(p_sos text, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.orbii_can_access_sos(p_sos) then
    raise exception 'not permitted' using errcode = '42501';
  end if;
  update sos_escalations
     set released_at = now()
   where sos_id = p_sos and claimed_by = auth.uid() and action = p_action and released_at is null;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.release_sos_escalation(text, text) from public, anon;
grant execute on function public.release_sos_escalation(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- WHO IS DOING WHAT
-- ---------------------------------------------------------------------------
-- The whole point: everyone looking at this SOS sees the same answer, so nobody
-- has to guess whether somebody else has it in hand.
create or replace function public.sos_escalation_state(p_sos text)
returns table (action text, name text, claimed_by uuid, at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select e.action,
         coalesce(u.name, 'Someone')::text,
         e.claimed_by,
         e.at,
         e.claimed_by = auth.uid()
  from sos_escalations e
  left join users_public u on u.id = e.claimed_by
  where e.sos_id = p_sos
    and e.released_at is null
    and public.orbii_can_access_sos(p_sos)
  order by e.at;
$$;

revoke all on function public.sos_escalation_state(text) from public, anon;
grant execute on function public.sos_escalation_state(text) to authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
select 'escalations table' as check,
       (to_regclass('public.sos_escalations') is not null)::text as result
union all
select 'claim rpc', (to_regprocedure('public.claim_sos_escalation(text,text)') is not null)::text
union all
select 'release rpc (must exist, a claim you cannot drop is a lie)',
       (to_regprocedure('public.release_sos_escalation(text,text)') is not null)::text
union all
select 'state rpc', (to_regprocedure('public.sos_escalation_state(text)') is not null)::text
union all
select 'no direct table access for signed-in users (must be false)',
       has_table_privilege('authenticated', 'public.sos_escalations', 'select')::text
union all
select 'anon has nothing (must be false)',
       has_table_privilege('anon', 'public.sos_escalations', 'select')::text;
