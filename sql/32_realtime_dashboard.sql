-- ORBII — make the responder dashboard live.
-- Publishes the tables the Missions dashboard reads so it updates over Supabase
-- realtime (trust, level, wallet, payouts) without the helper reopening the app.
-- Idempotent + guarded so a re-run never fails with "already member of
-- publication" (which would roll back the whole script). Paste into the
-- Supabase SQL editor and run once.
do $$
declare t text;
begin
  foreach t in array array['helper_profiles','payout_requests'] loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table %I', t);
    end if;
  end loop;
end $$;
