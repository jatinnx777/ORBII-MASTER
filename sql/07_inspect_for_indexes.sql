-- Run both blocks. Paste the output back so the index script can be
-- rewritten against the actual schema (not the schema I guessed).

-- ---------------------------------------------------------------------------
-- A. Every public table you have
-- ---------------------------------------------------------------------------
select tablename
from pg_tables
where schemaname = 'public'
order by tablename;

-- ---------------------------------------------------------------------------
-- B. Columns of every table that might need an index. Filter is
--    intentionally broad — anything chat / friends / sos / contacts
--    related is fair game.
-- ---------------------------------------------------------------------------
select
  table_name,
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and (
    table_name like '%friend%'
    or table_name like '%message%'
    or table_name like '%chat%'
    or table_name like '%sos%'
    or table_name like '%alert%'
    or table_name like '%emergency%'
    or table_name like '%contact%'
    or table_name like '%circle%'
    or table_name in ('profiles', 'users_public')
  )
order by table_name, ordinal_position;
