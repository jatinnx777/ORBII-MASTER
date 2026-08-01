-- 53_mesh_bridge.sql
--
-- Backing tables for the offline mesh bridge (supabase/functions/mesh-bridge).
-- Run once in Supabase.

-- Tag SOS events that arrived over the mesh (vs a normal online SOS).
alter table sos_events add column if not exists source text not null default 'app';

-- Dedup: many relays may bridge the same mesh SOS. First insert wins; later
-- relays hit the unique key and no-op, so the victim gets ONE alert.
create table if not exists mesh_bridged (
  msg_id     text primary key,
  user_id    uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Only the mesh-bridge function (service role) ever writes here; no client
-- access needed.
alter table mesh_bridged enable row level security;
