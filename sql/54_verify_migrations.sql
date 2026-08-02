-- 54_verify_migrations.sql
--
-- READ-ONLY self-check. Paste this whole file into the Supabase SQL editor and
-- run it. It changes NOTHING. It just lists every database object the recent
-- migrations (46 through 53) were supposed to create, and whether each one is
-- actually present.
--
-- How to read the result:
--   * Every row says OK   -> you have run all the SQL, nothing is missing.
--   * Any row says MISSING -> open the migration file it names (in the sql/
--     folder) and run that file in the SQL editor. Then run this check again.
--
-- Note on 52_helper_reputation.sql: it only REDEFINES existing functions (it
-- adds a "helped" count + a ranking boost), so it creates no new object this
-- catalog check can see. Confirm 52 ran by checking that a community profile
-- shows a "helped" number.

with expected(name, kind, migration) as (
  values
    -- Tables --------------------------------------------------------------
    ('community_profiles',       'table',  '47_community_v2.sql'),
    ('community_follows',        'table',  '47_community_v2.sql'),
    ('community_blocks',         'table',  '47_community_v2.sql'),
    ('user_sessions',            'table',  '50_sessions_and_notifications.sql'),
    ('community_notifications',  'table',  '50_sessions_and_notifications.sql'),
    ('sos_arrival_codes',        'table',  '51_arrival_codes.sql'),
    ('mesh_bridged',             'table',  '53_mesh_bridge.sql'),
    -- Functions -----------------------------------------------------------
    ('dispatch_community_helpers',        'function', '46_community_dispatch.sql'),
    ('community_my_profile_id',           'function', '47_community_v2.sql'),
    ('community_feed_v2',                 'function', '47_community_v2.sql (redefined by 49, 52)'),
    ('community_create_post',             'function', '47_community_v2.sql'),
    ('community_add_comment',             'function', '47_community_v2.sql (redefined by 49)'),
    ('community_comments_v2',             'function', '47_community_v2.sql (redefined by 49)'),
    ('community_profile_upsert',          'function', '47_community_v2.sql'),
    ('community_profile_public',          'function', '47_community_v2.sql (redefined by 52)'),
    ('community_follow',                  'function', '47_community_v2.sql'),
    ('community_block',                   'function', '47_community_v2.sql'),
    ('community_user_feed',               'function', '48_community_profile.sql'),
    ('claim_session',                     'function', '50_sessions_and_notifications.sql'),
    ('community_notify_reaction',         'function', '50_sessions_and_notifications.sql'),
    ('community_notify_comment',          'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_list',      'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_mark_read', 'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_unread_count','function','50_sessions_and_notifications.sql'),
    ('mint_arrival_codes',                'function', '51_arrival_codes.sql'),
    ('submit_arrival_code',               'function', '51_arrival_codes.sql'),
    -- Columns (table.column) ---------------------------------------------
    ('community_posts.author_profile_id', 'column', '47_community_v2.sql'),
    ('community_posts.title',             'column', '47_community_v2.sql'),
    ('community_posts.category',          'column', '47_community_v2.sql'),
    ('community_posts.hidden',            'column', '47_community_v2.sql'),
    ('community_comments.author_profile_id','column','47_community_v2.sql'),
    ('community_comments.parent_id',      'column', '49_community_replies_ranking.sql'),
    ('sos_events.source',                 'column', '53_mesh_bridge.sql')
),
checked as (
  select
    e.migration,
    e.kind,
    e.name,
    case e.kind
      when 'table' then to_regclass('public.' || e.name) is not null
      when 'function' then exists (
        select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = e.name
      )
      when 'column' then exists (
        select 1
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name  = split_part(e.name, '.', 1)
          and c.column_name = split_part(e.name, '.', 2)
      )
      else false
    end as present
  from expected e
)
select
  case when present then 'OK' else 'MISSING' end as status,
  kind,
  name,
  case when present then '' else 'run ' || migration end as action
from checked
order by present asc, migration, name;

-- One-line summary: how many objects are still missing.
with expected(name, kind) as (
  values
    ('community_profiles','table'),('community_follows','table'),('community_blocks','table'),
    ('user_sessions','table'),('community_notifications','table'),('sos_arrival_codes','table'),
    ('mesh_bridged','table'),
    ('dispatch_community_helpers','function'),('community_my_profile_id','function'),
    ('community_feed_v2','function'),('community_create_post','function'),
    ('community_add_comment','function'),('community_comments_v2','function'),
    ('community_profile_upsert','function'),('community_profile_public','function'),
    ('community_follow','function'),('community_block','function'),('community_user_feed','function'),
    ('claim_session','function'),('community_notify_reaction','function'),
    ('community_notify_comment','function'),('community_notifications_list','function'),
    ('community_notifications_mark_read','function'),('community_notifications_unread_count','function'),
    ('mint_arrival_codes','function'),('submit_arrival_code','function'),
    ('community_posts.author_profile_id','column'),('community_posts.title','column'),
    ('community_posts.category','column'),('community_posts.hidden','column'),
    ('community_comments.author_profile_id','column'),('community_comments.parent_id','column'),
    ('sos_events.source','column')
)
select count(*) filter (where not present) as objects_missing,
       count(*) as objects_checked
from (
  select
    case e.kind
      when 'table' then to_regclass('public.' || e.name) is not null
      when 'function' then exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = e.name)
      when 'column' then exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name  = split_part(e.name, '.', 1)
          and c.column_name = split_part(e.name, '.', 2))
      else false
    end as present
  from expected e
) s;
