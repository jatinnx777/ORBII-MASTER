-- ORBII SOS history. Each row mirrors a single SOSRecord on the device.
-- Rows are upserted by client-generated `id` (sos_<ts>_<rand>) so the local
-- and server records stay in sync without a round-trip.
--
-- If you already have a different `sos_events` schema, drop the block
-- below or coalesce columns. Idempotent — safe to re-run.

-- If table exists with `id uuid` from earlier code path, this migration
-- adds the columns we now need without touching ID type.
create table if not exists sos_events (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  address text,
  status text not null default 'active'
    check (status in ('active', 'resolved', 'cancelled')),
  kind text not null default 'real' check (kind in ('real', 'test')),
  user_name text,
  user_photo text,
  responder_id uuid,
  responder_name text,
  responder_photo text,
  rating int,
  response_time int,
  resolved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- For projects that had the old schema with `id uuid` — try to add
-- the new columns one-by-one (each statement no-ops if the column exists).
alter table sos_events add column if not exists kind text default 'real';
alter table sos_events add column if not exists user_name text;
alter table sos_events add column if not exists user_photo text;
alter table sos_events add column if not exists responder_id uuid;
alter table sos_events add column if not exists responder_name text;
alter table sos_events add column if not exists responder_photo text;
alter table sos_events add column if not exists rating int;
alter table sos_events add column if not exists response_time int;
alter table sos_events add column if not exists resolved_at timestamptz;
alter table sos_events add column if not exists updated_at timestamptz default now();

create index if not exists sos_events_user_idx
  on sos_events (user_id, created_at desc);

create index if not exists sos_events_active_idx
  on sos_events (status, created_at desc) where status = 'active';

alter table sos_events enable row level security;

drop policy if exists "sos read own" on sos_events;
create policy "sos read own"
  on sos_events for select
  using (auth.uid() = user_id);

-- Helpers (anyone signed in) can read ACTIVE alerts so they can respond.
drop policy if exists "sos read active" on sos_events;
create policy "sos read active"
  on sos_events for select
  using (status = 'active');

drop policy if exists "sos insert own" on sos_events;
create policy "sos insert own"
  on sos_events for insert
  with check (auth.uid() = user_id);

drop policy if exists "sos update own" on sos_events;
create policy "sos update own"
  on sos_events for update
  using (auth.uid() = user_id);
