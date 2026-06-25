-- 20_push_tokens.sql
-- ============================================================================
-- Device push tokens, so an SOS can reach a victim's circle + emergency
-- contacts even when their app is closed (the realtime broadcast only reaches
-- apps that are currently open). One token per user (latest device wins).
--
-- The `notify-sos` edge function (service role) reads this table to fan out a
-- push when an sos_events row is created. Clients only ever read/write their
-- OWN row.
-- ============================================================================

create table if not exists push_tokens (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null default 'android',
  updated_at timestamptz not null default now()
);

alter table push_tokens enable row level security;

drop policy if exists "push read own" on push_tokens;
create policy "push read own"
  on push_tokens for select
  using (auth.uid() = user_id);

drop policy if exists "push insert own" on push_tokens;
create policy "push insert own"
  on push_tokens for insert
  with check (auth.uid() = user_id);

drop policy if exists "push update own" on push_tokens;
create policy "push update own"
  on push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update on push_tokens to authenticated;
