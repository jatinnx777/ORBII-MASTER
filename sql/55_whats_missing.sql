-- 55_whats_missing.sql
--
-- READ-ONLY. Paste into the Supabase SQL editor and run. It changes NOTHING.
-- Unlike 54 (which lists everything), this returns ONLY the objects that are
-- still missing, by name, with the file you need to run for each.
--
--   * Zero rows returned  -> nothing is missing, you have run all the SQL.
--   * Any rows returned    -> open each "run_this_file" and run it in the SQL
--     editor, then run this check again until it comes back empty.
--
-- Note: 52_helper_reputation.sql only redefines existing functions, so it
-- creates no new object this catalog check can see. Confirm 52 ran by checking
-- that a community profile shows a "helped" number.

with expected(name, kind, migration) as (
  values
    -- Tables
    ('community_profiles',       'table',  '47_community_v2.sql'),
    ('community_follows',        'table',  '47_community_v2.sql'),
    ('community_blocks',         'table',  '47_community_v2.sql'),
    ('user_sessions',            'table',  '50_sessions_and_notifications.sql'),
    ('community_notifications',  'table',  '50_sessions_and_notifications.sql'),
    ('sos_arrival_codes',        'table',  '51_arrival_codes.sql'),
    ('mesh_bridged',             'table',  '53_mesh_bridge.sql'),
    -- Functions
    ('dispatch_community_helpers',          'function', '46_community_dispatch.sql'),
    ('community_my_profile_id',             'function', '47_community_v2.sql'),
    ('community_feed_v2',                   'function', '47_community_v2.sql'),
    ('community_create_post',               'function', '47_community_v2.sql'),
    ('community_add_comment',               'function', '47_community_v2.sql'),
    ('community_comments_v2',               'function', '47_community_v2.sql'),
    ('community_profile_upsert',            'function', '47_community_v2.sql'),
    ('community_profile_public',            'function', '47_community_v2.sql'),
    ('community_follow',                    'function', '47_community_v2.sql'),
    ('community_block',                     'function', '47_community_v2.sql'),
    ('community_user_feed',                 'function', '48_community_profile.sql'),
    ('claim_session',                       'function', '50_sessions_and_notifications.sql'),
    ('community_notify_reaction',           'function', '50_sessions_and_notifications.sql'),
    ('community_notify_comment',            'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_list',        'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_mark_read',   'function', '50_sessions_and_notifications.sql'),
    ('community_notifications_unread_count','function', '50_sessions_and_notifications.sql'),
    ('mint_arrival_codes',                  'function', '51_arrival_codes.sql'),
    ('submit_arrival_code',                 'function', '51_arrival_codes.sql'),
    -- Columns (table.column)
    ('community_posts.author_profile_id',   'column', '47_community_v2.sql'),
    ('community_posts.title',               'column', '47_community_v2.sql'),
    ('community_posts.category',            'column', '47_community_v2.sql'),
    ('community_posts.hidden',              'column', '47_community_v2.sql'),
    ('community_comments.author_profile_id','column', '47_community_v2.sql'),
    ('community_comments.parent_id',        'column', '49_community_replies_ranking.sql'),
    ('sos_events.source',                   'column', '53_mesh_bridge.sql')
)
select
  e.migration as run_this_file,
  e.kind,
  e.name as missing_object
from expected e
where not (
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
  end
)
order by e.migration, e.name;
