-- 51_arrival_codes.sql
--
-- Phase C: multi-helper arrival codes. Extends the single rescue code (sql/36)
-- so that EACH verified helper gets their OWN 4-digit code, while all
-- non-verified helpers share ONE code. The victim's screen shows every code;
-- each helper, standing in front of her, reads their code and submits it. When
-- every code has been entered, the SOS auto-resolves.
--
-- Verified status is read server-side from profiles.is_verified — never trusted
-- from the client. Helpers never read the codes; they submit a guess to a
-- SECURITY DEFINER function, same proof-of-arrival trick as sql/36.
--
-- This is ADDITIVE: the old single-code path (sql/36) still works, and the
-- victim's manual "I'm safe" resolve is untouched. Run once in Supabase.

create table if not exists sos_arrival_codes (
  id           uuid primary key default gen_random_uuid(),
  sos_id       uuid not null references sos_events(id) on delete cascade,
  kind         text not null check (kind in ('verified', 'shared')),
  -- verified: the specific helper this code belongs to. shared: null.
  assignee_id  uuid references auth.users(id) on delete cascade,
  code         text not null check (code ~ '^[0-9]{4}$'),
  entered      boolean not null default false,
  entered_name text,
  entered_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- One code per verified helper per SOS, and at most one shared code per SOS.
create unique index if not exists sos_arrival_codes_verified_uq
  on sos_arrival_codes (sos_id, assignee_id) where kind = 'verified';
create unique index if not exists sos_arrival_codes_shared_uq
  on sos_arrival_codes (sos_id) where kind = 'shared';

alter table sos_arrival_codes enable row level security;

-- Only the victim (SOS owner) may read the codes, to show them on her screen.
-- Helpers never read them; they submit via submit_arrival_code().
drop policy if exists arrival_codes_owner_read on sos_arrival_codes;
create policy arrival_codes_owner_read on sos_arrival_codes
  for select to authenticated
  using (exists (select 1 from sos_events e where e.id = sos_id and e.user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- Victim: mint/refresh the codes for her SOS and read them back. Idempotent —
-- adds a code for any newly-arrived verified helper and the shared code if any
-- non-verified helper is on the way, without disturbing codes already entered.
-- ---------------------------------------------------------------------------
create or replace function public.mint_arrival_codes(p_sos uuid)
returns table (
  kind text,
  assignee_id uuid,
  assignee_name text,
  code text,
  entered boolean,
  entered_name text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  owner uuid;
  r record;
  need_shared boolean := false;
begin
  if uid is null then raise exception 'auth required'; end if;
  select user_id into owner from sos_events where id = p_sos;
  if owner is null or owner <> uid then raise exception 'not your SOS'; end if;

  -- One code slot per responder on record for this SOS.
  for r in
    select re.helper_id, coalesce(p.is_verified, false) as verified
    from rescue_events re
    left join profiles p on p.id = re.helper_id
    where re.sos_id = p_sos
  loop
    if r.verified then
      insert into sos_arrival_codes (sos_id, kind, assignee_id, code)
      values (p_sos, 'verified', r.helper_id, lpad((floor(random() * 10000))::int::text, 4, '0'))
      on conflict do nothing;
    else
      need_shared := true;
    end if;
  end loop;

  if need_shared then
    insert into sos_arrival_codes (sos_id, kind, assignee_id, code)
    values (p_sos, 'shared', null, lpad((floor(random() * 10000))::int::text, 4, '0'))
    on conflict do nothing;
  end if;

  return query
    select c.kind, c.assignee_id, pr.name, c.code, c.entered, c.entered_name
    from sos_arrival_codes c
    left join profiles pr on pr.id = c.assignee_id
    where c.sos_id = p_sos
    order by (c.kind = 'shared'), c.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- Helper: submit the code read off the victim's screen, with their name.
-- Returns { ok, wrong, all_done }. all_done is true once every code for the SOS
-- has been entered, at which point the SOS is auto-resolved.
-- ---------------------------------------------------------------------------
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

  select count(*) into v_remaining from sos_arrival_codes
    where sos_id = p_sos and entered = false;

  if v_remaining = 0 then
    update sos_events set status = 'resolved', resolved_at = now()
    where id = p_sos and status = 'active';
    return jsonb_build_object('ok', true, 'wrong', false, 'all_done', true);
  end if;

  return jsonb_build_object('ok', true, 'wrong', false, 'all_done', false);
end $$;

revoke all on function public.mint_arrival_codes(uuid) from public, anon;
revoke all on function public.submit_arrival_code(uuid, text, text) from public, anon;
grant execute on function public.mint_arrival_codes(uuid) to authenticated;
grant execute on function public.submit_arrival_code(uuid, text, text) to authenticated;
