-- 82_arrival_resolve_fix.sql
-- ============================================================================
-- Fix a regression sql/81 introduced, and be precise about what an arrival
-- actually means.
--
-- THE REGRESSION. submit_arrival_code decides an SOS is finished like this:
--
--   select count(*) into v_remaining from sos_arrival_codes
--     where sos_id = p_sos and entered = false;
--   if v_remaining = 0 then ... mark resolved ...
--
-- sql/81 made the shared code unconditional so the victim's screen is never
-- empty. Correct on its own, but it means there is now always one code that
-- nobody owns. A verified helper enters their personal code, the shared code
-- sits there forever, v_remaining never reaches zero, and the SOS can never
-- close. all_done never comes back true either, so the helper's app never
-- confirms the arrival landed.
--
-- THE FIX. Count only codes somebody is actually expected to enter:
--   * every VERIFIED code, because each belongs to a named responder;
--   * the SHARED code only if an unverified responder actually exists.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ON "IF SOMEONE GAVE THE CODE, HELP HAS ARRIVED".
--
-- True, and the system already acts on it: the escalation tick in sql/78 counts
-- entered codes and stops widening the search the moment one lands. Nobody else
-- is dispatched after that.
--
-- What it deliberately does NOT do is mark the emergency over, and that is the
-- single most important judgement in the whole escalation design. sql/78 puts
-- it plainly: an SOS that people have ARRIVED at but nobody has resolved is the
-- most dangerous state in the system, because it looks handled. Helpers were
-- sent, helpers got there, the dashboard is green, and she is still in trouble.
--
-- So arrival starts a clock rather than stopping one: grace period, then ask
-- her, then send more people if she does not answer. Auto-resolving on the
-- first code would delete that ladder, because the tick only looks at events
-- whose status is still 'active'.
--
-- The SOS therefore ends in exactly two ways:
--   1. She says she is safe (sos_answer_safety_check), or
--   2. Everybody who was expected to arrive has arrived.
--
-- A helper's code proves they are standing there. Only she can say it is over.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Idempotent. Run AFTER sql/81.
-- ============================================================================

create or replace function public.submit_arrival_code(p_sos uuid, p_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  v_id uuid;
  v_remaining int;
  v_has_unverified boolean;
begin
  if uid is null then raise exception 'auth required'; end if;

  -- A verified helper must enter THEIR own code; anyone may enter the shared one.
  select id into v_id
  from sos_arrival_codes
  where sos_id = p_sos
    and entered = false
    and code = p_code
    and ((kind = 'verified' and assignee_id = uid) or kind = 'shared')
  limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'wrong', true, 'all_done', false);
  end if;

  update sos_arrival_codes
    set entered = true, entered_name = p_name, entered_at = now()
  where id = v_id;

  -- Mark this helper as arrived + victim-confirmed, mirroring sql/36.
  update rescue_events
    set victim_confirmed = true,
        arrived_at = coalesce(arrived_at, now()),
        arrival_rank = coalesce(
          arrival_rank,
          (select count(*) + 1 from rescue_events e2
            where e2.sos_id = p_sos and e2.arrived_at is not null)
        )
  where sos_id = p_sos and helper_id = uid;

  -- Is anybody actually relying on the shared code?
  --
  -- Responders come from two tables that use different types for sos_id:
  -- sos_responders.sos_id is text, rescue_events.sos_id is uuid. Same split
  -- sql/81 had to bridge.
  select exists (
    with responders as (
      select r.user_id as helper_id from sos_responders r where r.sos_id = p_sos::text
      union
      select rv.helper_id from rescue_events rv where rv.sos_id = p_sos
    )
    select 1
    from responders d
    left join profiles p on p.id = d.helper_id
    left join helper_profiles hp on hp.user_id = d.helper_id
    where not (
      coalesce(p.is_verified, false)
      or coalesce(hp.verification_status, '') = 'verified'
    )
  ) into v_has_unverified;

  -- Count only what somebody is expected to enter. An unowned shared code is
  -- a spare key on the victim's screen, not an outstanding obligation.
  select count(*) into v_remaining
  from sos_arrival_codes c
  where c.sos_id = p_sos
    and c.entered = false
    and (c.kind = 'verified' or v_has_unverified);

  if v_remaining = 0 then
    update sos_events set status = 'resolved', resolved_at = now()
    where id = p_sos and status = 'active';
    return jsonb_build_object('ok', true, 'wrong', false, 'all_done', true);
  end if;

  return jsonb_build_object('ok', true, 'wrong', false, 'all_done', false);
end $$;

revoke all on function public.submit_arrival_code(uuid, text, text) from public, anon;
grant execute on function public.submit_arrival_code(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- VERIFY
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  select string_agg(n || ': ' || v, e'\n') into msg from (
    select 'submit ignores unowned shared code' as n,
           case when (select prosrc from pg_proc
                      where proname = 'submit_arrival_code' limit 1)
                     like '%v_has_unverified%' then 'ok' else 'MISSING' end as v
    union all
    select 'escalation still gates on arrival',
           case when (select prosrc from pg_proc
                      where proname = 'sos_escalation_tick' limit 1)
                     like '%entered_at is not null%' then 'ok' else 'CHECK' end
  ) c;
  raise notice e'\n%', msg;
end $$;
