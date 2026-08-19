-- 76_community_bridging.sql
-- ============================================================================
-- Bridging-based ranking for the community feed.
--
-- WHY NOT UPVOTES
-- A safety feed ranked by net upvotes rewards whatever the biggest group on
-- campus already believes. On a women's safety app that is actively dangerous:
-- "that hostel warden is fine, stop complaining" can out-vote a real warning,
-- and a rumour about a specific person can be brigaded to the top by a friend
-- group. Majority rule is the wrong instrument for this content.
--
-- WHAT REPLACES IT
-- The bridging algorithm X uses for Community Notes. Instead of asking "how
-- many people liked this", it asks "did people who usually DISAGREE with each
-- other both find this helpful". A post only rises if it bridges groups that
-- normally rate things differently.
--
-- The model (unchanged from the published one):
--
--     r̂_un = μ + i_u + i_n + f_u · f_n
--
--   μ    global intercept
--   i_u  how generous this rater is in general
--   i_n  THE POST'S SCORE, what we rank on
--   f_u  the rater's latent viewpoint
--   f_n  the post's latent viewpoint
--
-- Fitting is least squares with λ_i = 0.15 on intercepts and λ_f = 0.03 on
-- factors. Intercept regularisation is deliberately 5x the factor
-- regularisation: it makes the model prefer explaining a rating by "this post
-- appeals to one camp" (f) over "this post is good" (i), so a post has to be
-- genuinely cross-cutting before i_n rises. That asymmetry IS the bridge.
--
-- The fit itself runs in the score-community edge function, because iterative
-- gradient descent belongs in code, not in plpgsql. This file owns the schema,
-- the thresholds, and the read path.
--
-- Idempotent. Run once in Supabase -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Ratings. Three levels, mapped exactly as the published model does:
--    helpful = 1.0, somewhat = 0.5, not helpful = 0.0
-- ---------------------------------------------------------------------------
create table if not exists community_ratings (
  post_id    uuid not null references community_posts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  rating     text not null check (rating in ('helpful', 'somewhat', 'not_helpful')),
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists community_ratings_post_idx on community_ratings (post_id);
create index if not exists community_ratings_user_idx on community_ratings (user_id);

alter table community_ratings enable row level security;

-- Ratings are public (the whole point is a shared judgement), but you may only
-- write your own.
drop policy if exists "ratings read" on community_ratings;
create policy "ratings read" on community_ratings
  for select to authenticated using (true);
drop policy if exists "ratings write own" on community_ratings;
create policy "ratings write own" on community_ratings
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. Where the fitted scores land.
-- ---------------------------------------------------------------------------
alter table community_posts add column if not exists note_intercept double precision;
alter table community_posts add column if not exists note_factor double precision;
alter table community_posts add column if not exists rated_count int not null default 0;
alter table community_posts add column if not exists scored_at timestamptz;
-- 'needs_more' until it clears the bar, then 'helpful' or 'not_helpful'.
alter table community_posts add column if not exists bridge_status text
  not null default 'needs_more'
  check (bridge_status in ('needs_more', 'helpful', 'not_helpful'));

create index if not exists community_posts_bridge_idx
  on community_posts (bridge_status, note_intercept desc nulls last, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Thresholds, kept in one place so they are auditable rather than buried.
--
--    MIN_RATINGS  5    below this a post is never given a verdict at all
--    HELPFUL      i_n >= 0.40 AND abs(f_n) < 0.50
--                      the factor bound is what stops a post that one camp
--                      loves from being called helpful
--    NOT_HELPFUL  i_n < -0.05 - 0.8 * abs(f_n)
--                      the sliding bar means a divisive post needs a much
--                      worse intercept before we call it unhelpful, so we do
--                      not silence a minority warning just for being divisive
-- ---------------------------------------------------------------------------
create or replace function public.community_bridge_status(
  p_intercept double precision,
  p_factor double precision,
  p_ratings int
)
returns text
language sql immutable as $$
  select case
    when p_ratings < 5 or p_intercept is null then 'needs_more'
    when p_intercept >= 0.40 and abs(coalesce(p_factor, 0)) < 0.50 then 'helpful'
    when p_intercept < -0.05 - 0.8 * abs(coalesce(p_factor, 0)) then 'not_helpful'
    else 'needs_more'
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Rate a post. One row per (post, user); rating again replaces it.
-- ---------------------------------------------------------------------------
create or replace function public.community_rate(p_post uuid, p_rating text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'auth required'; end if;
  if p_rating is null then
    delete from community_ratings where post_id = p_post and user_id = auth.uid();
  else
    insert into community_ratings (post_id, user_id, rating)
      values (p_post, auth.uid(), p_rating)
    on conflict (post_id, user_id) do update set rating = excluded.rating, created_at = now();
  end if;
  update community_posts
    set rated_count = (select count(*) from community_ratings r where r.post_id = p_post)
    where id = p_post;
end $$;

grant execute on function public.community_rate(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Write back a fitted batch. Called by the edge function with the service
--    role, so it is not exposed to users.
-- ---------------------------------------------------------------------------
create or replace function public.community_apply_scores(p_scores jsonb)
returns int
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb;
  n int := 0;
begin
  for rec in select * from jsonb_array_elements(p_scores) loop
    update community_posts
      set note_intercept = (rec->>'intercept')::double precision,
          note_factor    = (rec->>'factor')::double precision,
          scored_at      = now(),
          bridge_status  = public.community_bridge_status(
                             (rec->>'intercept')::double precision,
                             (rec->>'factor')::double precision,
                             rated_count)
      where id = (rec->>'id')::uuid;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Everything the scorer needs, in one call.
-- ---------------------------------------------------------------------------
-- sql/77 replaces this with a weighted version, so it is dropped there too.
drop function if exists public.community_rating_matrix();

create or replace function public.community_rating_matrix()
returns table (post_id uuid, user_id uuid, value double precision)
language sql security definer set search_path = public stable as $$
  select r.post_id, r.user_id,
         case r.rating when 'helpful' then 1.0 when 'somewhat' then 0.5 else 0.0 end
  from community_ratings r;
$$;

-- ---------------------------------------------------------------------------
-- 6. The live feed, now ranked by the bridge.
--
-- This replaces the engagement score from sql/49. That formula ranked on
-- (ups - downs) + comments, decayed by age: a popularity contest with a recency
-- bonus. It rewards whatever the loudest group already agrees with, which is
-- the exact failure mode a safety feed cannot afford.
--
-- The order is now:
--   1. posts the bridge found genuinely helpful, best first
--   2. posts still being rated, using the old engagement score so a new post is
--      still discoverable before it has five ratings
--   3. posts the bridge found unhelpful, ranked down but NOT hidden
--
-- Not hiding them is deliberate. Ranking a post down is a judgement a reader
-- can overrule by scrolling; deleting it makes this a censorship tool, and the
-- day ORBII silences a warning because it was unpopular is the day it stops
-- being a safety product.
-- ---------------------------------------------------------------------------
-- Drop before create: this signature gains four columns (bridge_status,
-- rated_count, helpful_count, my_rating), and `create or replace` cannot change
-- a function's return type. Without this the whole file fails on its last
-- statement with 42P13 and the SQL editor rolls back everything above it,
-- including community_ratings, which is why sql/77 then reported a missing
-- table.
drop function if exists public.community_feed_v2(text, text, int, int);

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
  is_following boolean, is_mine boolean,
  bridge_status text, rated_count int, helpful_count bigint, my_rating text
)
language sql security definer set search_path = public stable as $$
  with me as (select community_my_profile_id() as pid),
  base as (
    select
      p.id, p.author_id, p.author_profile_id, p.title, p.body, p.category, p.created_at,
      p.bridge_status, p.rated_count, p.note_intercept,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0) as ups_c,
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0) as downs_c,
      coalesce((select count(*) from community_comments c where c.post_id = p.id), 0) as cc,
      coalesce((select count(*) from community_reports rp where rp.post_id = p.id), 0) as rc,
      coalesce((select count(*) from community_ratings g where g.post_id = p.id and g.rating = 'helpful'), 0) as hc,
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
    b.follows_author, (b.author_id = auth.uid()),
    b.bridge_status, b.rated_count, b.hc,
    (select g.rating from community_ratings g where g.post_id = b.id and g.user_id = auth.uid()) as my_rating
  from base b
  left join community_profiles cp on cp.id = b.author_profile_id
  order by
    -- 'mine' stays chronological: your own posts are a record, not a ranking.
    (case when p_tab = 'mine' then extract(epoch from b.created_at) else null end) desc nulls last,
    case b.bridge_status when 'helpful' then 0 when 'needs_more' then 1 else 2 end,
    b.note_intercept desc nulls last,
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
