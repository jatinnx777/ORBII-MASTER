-- Silences Supabase's "RLS Disabled in Public: public.spatial_ref_sys" warning.
-- Paste into Supabase → SQL Editor → Run (once). OPTIONAL — see note below.
--
-- `spatial_ref_sys` is a static PostGIS reference table (coordinate-system
-- definitions). It holds NO user data, so the warning is harmless. This
-- enables RLS + a public read policy so PostGIS still works and the linter
-- is satisfied.
--
-- NOTE: if either statement errors with "must be owner of table
-- spatial_ref_sys", your project doesn't grant ownership to the SQL-editor
-- role. In that case it's safe to simply ignore the warning — the table is
-- read-only reference data with nothing private in it.

alter table public.spatial_ref_sys enable row level security;

drop policy if exists "spatial_ref_sys public read" on public.spatial_ref_sys;
create policy "spatial_ref_sys public read"
  on public.spatial_ref_sys for select
  to public using (true);
