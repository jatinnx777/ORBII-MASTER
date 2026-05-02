-- ORBII emergency contacts. Per-user list, served via RLS so a user only
-- sees / writes their own rows. Paste into Supabase SQL editor.

-- `id` is a client-generated string ("c_TIMESTAMP") so the Redux store and
-- the server stay in sync without a round-trip on every insert. Keep it
-- as `text` not `uuid` for that reason.
create table if not exists emergency_contacts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  relation text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists emergency_contacts_user_idx
  on emergency_contacts (user_id);

alter table emergency_contacts enable row level security;

drop policy if exists "ec read own" on emergency_contacts;
create policy "ec read own"
  on emergency_contacts for select
  using (auth.uid() = user_id);

drop policy if exists "ec insert own" on emergency_contacts;
create policy "ec insert own"
  on emergency_contacts for insert
  with check (auth.uid() = user_id);

drop policy if exists "ec update own" on emergency_contacts;
create policy "ec update own"
  on emergency_contacts for update
  using (auth.uid() = user_id);

drop policy if exists "ec delete own" on emergency_contacts;
create policy "ec delete own"
  on emergency_contacts for delete
  using (auth.uid() = user_id);
