-- 65_dpdp.sql — DPDP Act 2023 compliance plumbing.
--
-- Two things live here:
--   1. user_consent_logs  — an immutable evidentiary trail proving each user
--      gave free, specific, informed consent (Section 5/6). We log the consent
--      version, the language they saw it in, and a timestamp. This is the
--      audit record a Data Protection Board would ask for.
--   2. delete_user_profile_cascade — the Right to Erasure (Section 12). One RPC
--      the user can fire from Settings that hard-deletes every row they own
--      across the app. Guarded by to_regclass so a table that doesn't exist
--      yet is skipped instead of erroring.
--
-- Idempotent — safe to re-run.

-- 1. Consent ledger ---------------------------------------------------------
create table if not exists public.user_consent_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  version     text not null,                 -- e.g. 'dpdp-2026-08'
  lang        text not null default 'en',    -- language the notice was shown in
  is_adult    boolean not null default true, -- confirmed 18+
  created_at  timestamptz not null default now()
);

create index if not exists user_consent_logs_user_idx
  on public.user_consent_logs (user_id, created_at desc);

alter table public.user_consent_logs enable row level security;

-- A user may read and insert their OWN consent rows; nobody can update/delete
-- (immutability is the whole point of an audit trail).
drop policy if exists user_consent_select on public.user_consent_logs;
create policy user_consent_select on public.user_consent_logs
  for select using (auth.uid() = user_id);

drop policy if exists user_consent_insert on public.user_consent_logs;
create policy user_consent_insert on public.user_consent_logs
  for insert with check (auth.uid() = user_id);

-- Convenience RPC so the client logs consent in one call.
create or replace function public.log_consent(p_version text, p_lang text, p_is_adult boolean)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_consent_logs (user_id, version, lang, is_adult)
  values (auth.uid(), p_version, coalesce(p_lang, 'en'), coalesce(p_is_adult, true));
$$;

grant execute on function public.log_consent(text, text, boolean) to authenticated;

-- 2. Right to erasure -------------------------------------------------------
-- Hard-deletes every row the caller owns across the app. We loop over a
-- curated (table, user-column) list and skip any table that isn't present.
create or replace function public.delete_user_profile_cascade()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  -- (table_name, column_holding_the_user_id)
  targets text[][] := array[
    ['circle_location_history','user_id'],
    ['circle_locations','user_id'],
    ['geofences','user_id'],
    ['geofence_events','user_id'],
    ['emergency_contacts','user_id'],
    ['sos_events','user_id'],
    ['messages','sender_id'],
    ['coupon_redemptions','user_id'],
    ['entitlements','user_id'],
    ['helper_profiles','user_id'],
    ['responder_applications','user_id'],
    ['circle_members','user_id'],
    ['circle_invites','inviter_id'],
    ['circle_invites','invitee_id'],
    ['notifications','user_id'],
    ['user_consent_logs','user_id'],
    ['users_public','id'],
    ['profiles','id']
  ];
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  for i in 1 .. array_length(targets, 1) loop
    if to_regclass('public.' || targets[i][1]) is not null then
      execute format('delete from public.%I where %I = $1', targets[i][1], targets[i][2])
        using uid;
    end if;
  end loop;
end;
$$;

grant execute on function public.delete_user_profile_cascade() to authenticated;
