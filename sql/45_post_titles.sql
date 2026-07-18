-- 45_post_titles.sql
-- ============================================================================
-- Reddit-style posts: a post now has a TITLE (the heading) plus the body
-- (the description). Title is optional so older posts still render.
-- ============================================================================

alter table community_posts
  add column if not exists title text check (title is null or char_length(title) <= 160);

-- community_feed must return the title too. Drop first: the return columns
-- changed, and Postgres won't CREATE OR REPLACE across a changed return type.
drop function if exists public.community_feed(int, int);
create or replace function public.community_feed(p_limit int default 50, p_offset int default 0)
returns table (
  id           uuid,
  author_id    uuid,
  author_name  text,
  author_photo text,
  title        text,
  body         text,
  created_at   timestamptz,
  ups          bigint,
  downs        bigint,
  comment_count bigint,
  my_vote      smallint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    p.id,
    p.author_id,
    coalesce(u.name, 'ORBII user') as author_name,
    u.photo_url as author_photo,
    p.title,
    p.body,
    p.created_at,
    coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0) as ups,
    coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0) as downs,
    coalesce((select count(*) from community_comments c where c.post_id = p.id), 0) as comment_count,
    (select r.value from community_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_vote
  from community_posts p
  left join users_public u on u.id = p.author_id
  order by p.created_at desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;
grant execute on function public.community_feed(int, int) to authenticated;
