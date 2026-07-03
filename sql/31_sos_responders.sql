-- 31_sos_responders.sql
-- ============================================================================
-- FIX: sos_responders had no migration in the repo (and so possibly no RLS).
-- The app records "I'm coming to help" rows here (responder name + photo per
-- SOS). Without RLS anyone could enumerate who responded to which emergency.
--
-- Safe to run whether or not the table already exists.
-- Access rules:
--   • a responder may insert their OWN response row
--   • a row is readable by the responder who wrote it AND by the victim of
--     that SOS (so their app can show "3 people are coming")
-- ============================================================================

create table if not exists sos_responders (
  id         bigint generated always as identity primary key,
  sos_id     text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text,
  photo_url  text,
  created_at timestamptz not null default now()
);
create index if not exists sos_responders_sos_idx on sos_responders(sos_id);

alter table sos_responders enable row level security;

drop policy if exists "sosr insert own" on sos_responders;
create policy "sosr insert own"
  on sos_responders for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "sosr read own or victim" on sos_responders;
create policy "sosr read own or victim"
  on sos_responders for select to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from sos_events e
      where e.id::text = sos_responders.sos_id and e.user_id = auth.uid()
    )
  );

grant insert, select on sos_responders to authenticated;
