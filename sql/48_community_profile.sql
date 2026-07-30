-- 48_community_profile.sql
-- ============================================================================
-- Public profile view: a user's posts, sorted. Powers the "tap a name/avatar
-- to open their profile" screen. Builds on 47. Returns the same shape as the
-- feed, filtered to one author, with newest / oldest / most-popular ordering.
-- Never leaks user_id (identity stays anonymous).
-- ============================================================================

create or replace function public.community_user_feed(
  p_profile_id uuid,
  p_sort text default 'newest',   -- 'newest' | 'oldest' | 'popular'
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id            uuid,
  author_profile_id uuid,
  handle        text,
  display_name  text,
  gender        text,
  avatar_key    text,
  title         text,
  body          text,
  category      text,
  created_at    timestamptz,
  ups           bigint,
  downs         bigint,
  comment_count bigint,
  my_vote       smallint,
  is_following  boolean,
  is_mine       boolean
)
language sql security definer set search_path = public stable as $$
  with me as (select community_my_profile_id() as pid),
  base as (
    select
      p.id, p.author_id, p.author_profile_id, p.title, p.body, p.category, p.created_at,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0) as ups_c,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0) as downs_c,
      coalesce((select count(*) from community_comments c where c.post_id = p.id), 0) as cc
    from community_posts p
    where p.author_profile_id = p_profile_id
      and (not p.hidden or p.author_id = auth.uid())
  )
  select
    b.id, b.author_profile_id,
    coalesce(cp.handle, 'orbii_user'), coalesce(cp.display_name, 'ORBII user'),
    coalesce(cp.gender, 'undisclosed'), coalesce(cp.avatar_key, 'a1'),
    b.title, b.body, b.category, b.created_at,
    b.ups_c, b.downs_c, b.cc,
    (select r.value from community_reactions r where r.post_id = b.id and r.user_id = auth.uid()) as my_vote,
    exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = b.author_profile_id),
    (b.author_id = auth.uid())
  from base b
  left join community_profiles cp on cp.id = b.author_profile_id
  order by
    (case when p_sort = 'oldest'  then b.created_at end) asc nulls last,
    (case when p_sort = 'popular' then (b.ups_c - b.downs_c + 0.5 * b.cc) end) desc nulls last,
    b.created_at desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;
grant execute on function public.community_user_feed(uuid, text, int, int) to authenticated;
