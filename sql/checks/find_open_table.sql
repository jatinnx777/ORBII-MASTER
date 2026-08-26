-- Name the table that has no RLS, and show what is genuinely reachable.
--
-- Read-only. Run this in the SQL editor and paste the rows back.
--
-- WHY THE "69" IN sql/93 WAS A BAD CHECK. Supabase ships
-- `grant all on all tables in schema public to anon, authenticated`, so almost
-- every table shows table-level write privilege. That is the intended design:
-- privilege is broad and RLS does the filtering. Counting privileges alone
-- counts the wrong thing and produces a scary number that means nothing.
--
-- Real exposure needs BOTH: the role holds the privilege AND no row filter
-- stops it. That is what this reports.

-- 1. The urgent one: RLS off, so no row filter exists at all.
select
  'NO RLS - FULLY OPEN' as severity,
  c.relname::text       as table_name,
  concat_ws(
    ',',
    case when has_table_privilege('anon', c.oid, 'select') then 'select' end,
    case when has_table_privilege('anon', c.oid, 'insert') then 'insert' end,
    case when has_table_privilege('anon', c.oid, 'update') then 'update' end,
    case when has_table_privilege('anon', c.oid, 'delete') then 'delete' end
  ) as anon_can,
  (select count(*) from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname)::int as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity

union all

-- 2. RLS on but nothing written, so every access is denied. Not a leak, but it
--    means a feature is silently dead and nobody noticed.
select
  'RLS ON, NO POLICY - feature may be broken',
  c.relname::text,
  '',
  0
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity
  and not exists (
    select 1 from pg_policies p
    where p.schemaname = 'public' and p.tablename = c.relname
  )

union all

-- 3. A policy that lets ANON (not just signed-in users) write. anon means
--    anybody holding the key from inside the APK, with no account at all.
select
  'ANON WRITE POLICY - justify each one',
  p.tablename::text,
  p.cmd::text,
  1
from pg_policies p
where p.schemaname = 'public'
  and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  and ('anon' = any(p.roles) or 'public' = any(p.roles))

order by 1, 2;
