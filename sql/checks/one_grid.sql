-- one_grid.sql
-- ============================================================================
-- ONE QUESTION: are the failing requests arriving as `anon` or `authenticated`?
--
-- The Postgres logs show three different errors at the same moment:
--     new row violates row-level security policy for table "circles"
--     permission denied for table app_events
--     permission denied for table users_public
--
-- If `authenticated` holds all three privileges and `anon` holds none, then
-- the app's requests are reaching Postgres as anon, and the session is the
-- bug, not the policies. If `authenticated` is missing any of them, the grant
-- is the bug and it is repaired directly.
--
-- Read only. Writes nothing.
-- ============================================================================

select
  t.label                                                as what,
  has_table_privilege('authenticated', t.tbl, t.priv)    as authenticated_can,
  has_table_privilege('anon',          t.tbl, t.priv)    as anon_can
from (values
  ('circles: INSERT',            'public.circles',      'INSERT'),
  ('circles: SELECT',            'public.circles',      'SELECT'),
  ('app_events: INSERT',         'public.app_events',   'INSERT'),
  ('users_public: SELECT',       'public.users_public', 'SELECT'),
  ('users_public: INSERT',       'public.users_public', 'INSERT'),
  ('users_public: UPDATE',       'public.users_public', 'UPDATE'),
  ('circle_invites: SELECT',     'public.circle_invites','SELECT'),
  ('profiles: INSERT',           'public.profiles',     'INSERT'),
  ('push_tokens: INSERT',        'public.push_tokens',  'INSERT')
) as t(label, tbl, priv)

union all

-- Which roles the circles INSERT policy actually applies to. If this says
-- {authenticated} then an anon request has NO insert policy at all, which is
-- reported as exactly the "new row violates row-level security policy" text.
select
  'POLICY ' || policyname || ' (' || cmd || ') applies to ' || roles::text,
  null, null
from pg_policies
where schemaname = 'public' and tablename = 'circles';
