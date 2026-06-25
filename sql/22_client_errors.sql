-- 22_client_errors.sql
-- ============================================================================
-- Crash / error visibility for the beta. The app's error pipeline
-- (services/error-reporting.ts) inserts here so you can watch real failures
-- from the Supabase dashboard — no Sentry account, native module, or DSN.
--
-- Clients may only INSERT (errors happen even pre-auth). Nobody can SELECT from
-- the client — you read it via the dashboard / SQL editor (service role).
-- ============================================================================

create table if not exists client_errors (
  id          bigint generated always as identity primary key,
  user_id     uuid references auth.users(id) on delete set null,
  category    text,
  message     text,
  stack       text,
  data        jsonb,
  breadcrumbs jsonb,
  platform    text,
  app_version text,
  created_at  timestamptz not null default now()
);

create index if not exists client_errors_created_idx on client_errors (created_at desc);

alter table client_errors enable row level security;

-- INSERT-only for clients (anon included — crashes can occur before sign-in).
drop policy if exists "client_errors insert" on client_errors;
create policy "client_errors insert"
  on client_errors for insert
  to anon, authenticated
  with check (true);

grant insert on client_errors to anon, authenticated;
