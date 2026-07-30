-- 49_community_replies_ranking.sql
-- ============================================================================
-- (1) One-level comment REPLIES (reply to a comment).
-- (2) The ORBII ranking algorithm, upgraded. Builds on 47/48.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (1) Replies: comments can point at a parent comment.
-- ---------------------------------------------------------------------------
alter table community_comments add column if not exists parent_id uuid references community_comments(id) on delete cascade;
create index if not exists community_comments_parent_idx on community_comments (parent_id);

-- add-comment now takes an optional parent. Drop the old 2-arg version first.
drop function if exists public.community_add_comment(uuid, text);
create or replace function public.community_add_comment(p_post uuid, p_body text, p_parent uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_id uuid; v_parent uuid;
begin
  v_pid := community_my_profile_id();
  if v_pid is null then
    raise exception 'Set up your community profile first' using errcode = '42501';
  end if;
  -- keep threads one level deep: a reply to a reply attaches to its top parent
  if p_parent is not null then
    select coalesce(parent_id, id) into v_parent from community_comments where id = p_parent;
  end if;
  insert into community_comments (post_id, author_id, author_profile_id, body, parent_id)
  values (p_post, auth.uid(), v_pid, trim(p_body), v_parent)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.community_add_comment(uuid, text, uuid) to authenticated;

-- comments listing now returns parent_id so the client can nest replies.
drop function if exists public.community_comments_v2(uuid);
create or replace function public.community_comments_v2(p_post uuid)
returns table (
  id uuid, parent_id uuid, author_profile_id uuid, handle text, display_name text,
  gender text, avatar_key text, body text, created_at timestamptz, is_mine boolean
)
language sql security definer set search_path = public stable as $$
  select c.id, c.parent_id, c.author_profile_id,
         coalesce(cp.handle, 'orbii_user'), coalesce(cp.display_name, 'ORBII user'),
         coalesce(cp.gender, 'undisclosed'), coalesce(cp.avatar_key, 'a1'),
         c.body, c.created_at, (c.author_id = auth.uid())
  from community_comments c
  left join community_profiles cp on cp.id = c.author_profile_id
  where c.post_id = p_post
  order by c.created_at asc;
$$;
grant execute on function public.community_comments_v2(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- (2) The ORBII ranking algorithm.
--
--   score =  ( likes - dislikes + 1.5*comments + 1 )      <- engagement, comments weighted higher
--            * category_boost                              <- emergency/safety float up (our mission)
--            * follow_boost                                <- posts from people you follow rank higher (personal)
--            / (age_hours + 2) ^ 1.5                        <- freshness decay (Hacker News gravity)
--            - reports * 0.5                                <- reported posts sink before auto-hide at 3
--
-- Comments are weighted 1.5x likes on purpose: discussion ("spilling the tea")
-- is the behaviour we want to reward, not just a quiet like.
-- ---------------------------------------------------------------------------
create or replace function public.community_feed_v2(
  p_tab text default 'explore',
  p_category text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid, author_profile_id uuid, handle text, display_name text, gender text,
  avatar_key text, title text, body text, category text, created_at timestamptz,
  ups bigint, downs bigint, comment_count bigint, my_vote smallint,
  is_following boolean, is_mine boolean
)
language sql security definer set search_path = public stable as $$
  with me as (select community_my_profile_id() as pid),
  base as (
    select
      p.id, p.author_id, p.author_profile_id, p.title, p.body, p.category, p.created_at,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0) as ups_c,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0) as downs_c,
      coalesce((select count(*) from community_comments c where c.post_id = p.id), 0) as cc,
      coalesce((select count(*) from community_reports rp where rp.post_id = p.id), 0) as rc,
      exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = p.author_profile_id) as follows_author
    from community_posts p
    where (p_category is null or p.category = p_category)
      and (case p_tab
             when 'mine' then p.author_id = auth.uid()
             when 'following' then p.author_profile_id in (select f.followed_id from community_follows f where f.follower_id = (select pid from me))
             else true end)
      and (not p.hidden or p.author_id = auth.uid())
      and not exists (
        select 1 from community_blocks b
        where (b.blocker_id = (select pid from me) and b.blocked_id = p.author_profile_id)
           or (b.blocked_id = (select pid from me) and b.blocker_id = p.author_profile_id))
  )
  select
    b.id, b.author_profile_id,
    coalesce(cp.handle, 'orbii_user'), coalesce(cp.display_name, 'ORBII user'),
    coalesce(cp.gender, 'undisclosed'), coalesce(cp.avatar_key, 'a1'),
    b.title, b.body, b.category, b.created_at,
    b.ups_c, b.downs_c, b.cc,
    (select r.value from community_reactions r where r.post_id = b.id and r.user_id = auth.uid()) as my_vote,
    b.follows_author, (b.author_id = auth.uid())
  from base b
  left join community_profiles cp on cp.id = b.author_profile_id
  order by
    (case when p_tab = 'mine' then extract(epoch from b.created_at) else null end) desc nulls last,
    (
      ((b.ups_c - b.downs_c) + 1.5 * b.cc + 1)
      * (case b.category when 'emergency' then 1.3 when 'safety' then 1.2 when 'legal' then 1.1 else 1.0 end)
      * (case when b.follows_author then 1.25 else 1.0 end)
      / power((extract(epoch from (now() - b.created_at)) / 3600.0) + 2, 1.5)
      - b.rc * 0.5
    ) desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;
grant execute on function public.community_feed_v2(text, text, int, int) to authenticated;
