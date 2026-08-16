-- 72_consent_audit.sql
-- ============================================================================
-- DPDP Act 2023 + DPDP Rules 2025 consent evidence.
--
-- The Rules were notified in November 2025. They require a Data Fiduciary to be
-- able to PROVE, per person and per purpose, that consent was given, what notice
-- was shown at the time, and when it was withdrawn. A boolean on a profile row
-- cannot do that: it has no history, so it cannot answer "what did she agree to
-- on 3 March, and what did the notice say that day".
--
-- This is an append-only ledger. Nothing is ever updated or deleted; a
-- withdrawal is a NEW row with granted = false. The current state of any consent
-- is simply the most recent row for that (user, purpose).
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

create table if not exists consent_events (
  id             bigserial primary key,
  user_id        uuid not null references auth.users(id) on delete cascade,

  -- What they agreed to. One row per purpose, never a single blanket consent,
  -- because the Rules require purpose-level granularity.
  --   'core'            account + emergency contacts, needed for the app to work
  --   'location_share'  live location visible to circle members
  --   'location_history' storing today's breadcrumb trail
  --   'voice_sos'       microphone listening for a distress word, on device
  --   'voice_donation'  uploading a clip to train our model
  --   'notifications'   push alerts
  purpose        text not null,

  granted        boolean not null,
  -- Version of the privacy notice that was on screen at that moment, so we can
  -- reproduce exactly what she was told.
  notice_version text not null,
  -- Language the notice was shown in. DPDP requires the notice be available in
  -- the Eighth Schedule languages, so we record which one was actually used.
  lang           text not null default 'en',
  -- How consent was captured: 'checkbox', 'toggle', 'os_permission', 'withdrawn'.
  method         text not null default 'checkbox',
  -- What the user declared about their age at the time. Under DPDP a child is
  -- anyone under 18, and processing their data needs verifiable parental
  -- consent, so this declaration is the pivot the whole compliance story turns on.
  is_adult       boolean,
  -- Coarse device string only. Never an IP, never a precise identifier: the
  -- audit trail must not itself become a privacy problem.
  device         text,
  created_at     timestamptz not null default now()
);

create index if not exists consent_events_user_idx
  on consent_events (user_id, purpose, created_at desc);

alter table consent_events enable row level security;

-- A user may write their own consent events and read their own history (DPDP
-- gives them a right to know what they agreed to). Nobody can update or delete:
-- there is deliberately no policy for either, so the ledger stays append-only
-- even for the account owner.
drop policy if exists consent_events_insert on consent_events;
create policy consent_events_insert on consent_events
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists consent_events_read_own on consent_events;
create policy consent_events_read_own on consent_events
  for select to authenticated
  using (user_id = auth.uid());

-- Record one consent decision. SECURITY DEFINER so the row is always stamped
-- with the real caller, never a client-supplied user id.
create or replace function public.log_consent_event(
  p_purpose text,
  p_granted boolean,
  p_notice_version text,
  p_lang text default 'en',
  p_method text default 'checkbox',
  p_is_adult boolean default null,
  p_device text default null
)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  insert into consent_events (user_id, purpose, granted, notice_version, lang, method, is_adult, device)
    values (auth.uid(), p_purpose, p_granted, p_notice_version, coalesce(p_lang,'en'),
            coalesce(p_method,'checkbox'), p_is_adult, p_device);
end $$;

grant execute on function public.log_consent_event(text, boolean, text, text, text, boolean, text) to authenticated;

-- Current state of every consent for the calling user: the newest row per
-- purpose. This is what the in-app "your privacy choices" screen should read.
create or replace function public.my_consents()
returns table (purpose text, granted boolean, notice_version text, decided_at timestamptz)
language sql security definer set search_path = public as $$
  select distinct on (purpose) purpose, granted, notice_version, created_at
  from consent_events
  where user_id = auth.uid()
  order by purpose, created_at desc;
$$;

grant execute on function public.my_consents() to authenticated;
