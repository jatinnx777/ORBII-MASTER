-- 52_helper_reputation.sql
--
-- Phase D: helper reputation in the community.
--   (1) A "helped" count on the public community profile = the number of
--       verified rescues this person completed (rescue_events.victim_confirmed).
--   (2) A 1.2x boost to a post's rank when its author has helped at least one
--       person, so people who actually show up get a little more reach.
--
-- Run once in Supabase. Additive; nothing else changes.

-- (1) Public profile gains a `helped` column. Return signature changes, so the
-- old function must be dropped first.
drop function if exists public.community_profile_public(uuid);
create or replace function public.community_profile_public(p_profile_id uuid)
returns table (id uuid, handle text, display_name text, gender text, avatar_key text, bio text,
               followers bigint, following bigint, is_following boolean, is_blocked boolean,
               helped bigint)
language sql security definer set search_path = public stable as $$
  with me as (select community_my_profile_id() as pid)
  select cp.id, cp.handle, cp.display_name, cp.gender, cp.avatar_key, cp.bio,
         (select count(*) from community_follows f where f.followed_id = cp.id),
         (select count(*) from community_follows f where f.follower_id = cp.id),
         exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = cp.id),
         exists (select 1 from community_blocks b where b.blocker_id = (select pid from me) and b.blocked_id = cp.id),
         (select count(*) from rescue_events re where re.helper_id = cp.user_id and re.victim_confirmed is true)
  from community_profiles cp where cp.id = p_profile_id;
$$;
grant execute on function public.community_profile_public(uuid) to authenticated;

-- (2) Ranking feed, with the helper boost added (same signature as sql/49).
--
--   score =  ( likes - dislikes + 1.5*comments + 1 )
--            * category_boost * follow_boost * helper_boost
--            / (age_hours + 2) ^ 1.5
--            - reports * 0.5
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
      exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = p.author_profile_id) as follows_author,
      coalesce((select count(*) from rescue_events re where re.helper_id = p.author_id and re.victim_confirmed is true), 0) as author_helped
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
      * (case when b.author_helped > 0 then 1.2 else 1.0 end)
      / power((extract(epoch from (now() - b.created_at)) / 3600.0) + 2, 1.5)
      - b.rc * 0.5
    ) desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;
grant execute on function public.community_feed_v2(text, text, int, int) to authenticated;
