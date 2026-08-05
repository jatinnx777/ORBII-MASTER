-- 66_helper_caps.sql — monthly help caps per helper level (anti-abuse).
--
-- Each verified helper can only perform a limited number of helps per calendar
-- month, scaled by their Guardian level. This stops a single account from
-- farming payouts and keeps the network honest. Levels mirror guardianLevel()
-- in src/services/helper-profile.ts (lifetime_responses + trust_score):
--
--   Bronze (Level 1)  ->  5 helps / month
--   Silver            -> 15 helps / month
--   Gold              -> 40 helps / month
--   Elite             -> effectively unlimited
--
-- Enforced server-side inside rescue_accept (the moment a helper accepts an
-- SOS), so a client cannot bypass it. Idempotent — safe to re-run.

-- Cap for a given helper, derived from their level. Non-helpers get the floor.
create or replace function public.helper_monthly_cap(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when hp.lifetime_responses >= 150 and hp.trust_score >= 90 then 9999  -- Elite
      when hp.lifetime_responses >= 50  and hp.trust_score >= 75 then 40    -- Gold
      when hp.lifetime_responses >= 10  and hp.trust_score >= 60 then 15    -- Silver
      else 5                                                                -- Bronze / L1
    end
    from public.helper_profiles hp
    where hp.user_id = p_uid
  ), 5);
$$;

-- How many DISTINCT rescues this helper has accepted this calendar month.
create or replace function public.helper_helps_this_month(p_uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.rescue_events
  where helper_id = p_uid
    and created_at >= date_trunc('month', now());
$$;

-- Dashboard helper: cap / used / remaining for the signed-in helper.
create or replace function public.helper_help_status()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'cap',       helper_monthly_cap(auth.uid()),
    'used',      helper_helps_this_month(auth.uid()),
    'remaining', greatest(0, helper_monthly_cap(auth.uid()) - helper_helps_this_month(auth.uid()))
  );
$$;

grant execute on function public.helper_monthly_cap(uuid) to authenticated;
grant execute on function public.helper_helps_this_month(uuid) to authenticated;
grant execute on function public.helper_help_status() to authenticated;

-- Redefine rescue_accept to enforce the monthly cap. Same signature as sql/33.
-- Re-accepting an SOS you already accepted (the on-conflict path) never counts
-- again, so hitting refresh can't burn a slot; only a brand-new rescue does.
create or replace function public.rescue_accept(
  p_sos uuid,
  p_victim uuid,
  p_sos_created timestamptz,
  p_device text,
  p_mock boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  id uuid;
  existing uuid;
  cap int;
  used int;
begin
  if uid is null then raise exception 'auth required'; end if;

  -- Only a NEW rescue counts against the cap.
  select re.id into existing
  from public.rescue_events re
  where re.sos_id = p_sos and re.helper_id = uid;

  if existing is null then
    cap  := public.helper_monthly_cap(uid);
    used := public.helper_helps_this_month(uid);
    if used >= cap then
      raise exception 'monthly_help_limit_reached'
        using errcode = 'P0001',
              hint = format('This month''s help limit (%s) is reached.', cap);
    end if;
  end if;

  insert into public.rescue_events
    (sos_id, helper_id, victim_id, accept_latency_sec, device_id, mock_location)
  values
    (p_sos, uid, p_victim,
     greatest(0, extract(epoch from (now() - coalesce(p_sos_created, now())))::int),
     p_device, coalesce(p_mock, false))
  on conflict (sos_id, helper_id) do update set device_id = excluded.device_id
  returning rescue_events.id into id;

  return id;
end;
$$;

grant execute on function public.rescue_accept(uuid, uuid, timestamptz, text, boolean) to authenticated;
