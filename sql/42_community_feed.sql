-- 42_community_feed.sql
-- ============================================================================
-- Community feed — a mini forum where users share safety experiences and
-- support each other. Posts, up/down votes, and comments. Signed-in users only.
--
-- Moderation posture: on a women's-safety app the feed can attract abuse, so
-- authorship is never anonymous to the SERVER (author_id is always the real
-- user), a user can delete their own post/comment, and there's a report path
-- (community_reports) an admin can act on. Display names come from users_public.
-- ============================================================================

create table if not exists community_posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists community_posts_new_idx on community_posts (created_at desc);
alter table community_posts enable row level security;

-- Anyone signed in can read the feed; you may only post as yourself, and delete
-- only your own posts.
drop policy if exists "posts read" on community_posts;
create policy "posts read" on community_posts for select to authenticated using (true);
drop policy if exists "posts insert self" on community_posts;
create policy "posts insert self" on community_posts
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists "posts delete own" on community_posts;
create policy "posts delete own" on community_posts
  for delete to authenticated using (auth.uid() = author_id);

-- Votes: +1 up, -1 down. One row per (post, user), flipping the value re-votes.
create table if not exists community_reactions (
  post_id  uuid not null references community_posts(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  value    smallint not null check (value in (-1, 1)),
  primary key (post_id, user_id)
);
alter table community_reactions enable row level security;
drop policy if exists "reactions read" on community_reactions;
create policy "reactions read" on community_reactions for select to authenticated using (true);
drop policy if exists "reactions write own" on community_reactions;
create policy "reactions write own" on community_reactions
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists community_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references community_posts(id) on delete cascade,
  author_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists community_comments_post_idx on community_comments (post_id, created_at);
alter table community_comments enable row level security;
drop policy if exists "comments read" on community_comments;
create policy "comments read" on community_comments for select to authenticated using (true);
drop policy if exists "comments insert self" on community_comments;
create policy "comments insert self" on community_comments
  for insert to authenticated with check (auth.uid() = author_id);
drop policy if exists "comments delete own" on community_comments;
create policy "comments delete own" on community_comments
  for delete to authenticated using (auth.uid() = author_id);

-- Reports — a user flags a post for an admin to review.
create table if not exists community_reports (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references community_posts(id) on delete cascade,
  reporter   uuid not null references auth.users(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  unique (post_id, reporter)
);
alter table community_reports enable row level security;
drop policy if exists "reports insert self" on community_reports;
create policy "reports insert self" on community_reports
  for insert to authenticated with check (auth.uid() = reporter);

-- The feed, assembled server-side so the client makes ONE call: each post with
-- its author name/photo, up/down counts, comment count, and the caller's own
-- vote. SECURITY DEFINER so it can read users_public + aggregate votes.
create or replace function public.community_feed(p_limit int default 50, p_offset int default 0)
returns table (
  id           uuid,
  author_id    uuid,
  author_name  text,
  author_photo text,
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

-- Cast (or change, or clear) a vote in one call.
create or replace function public.community_vote(p_post uuid, p_value int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_value = 0 then
    delete from community_reactions where post_id = p_post and user_id = auth.uid();
  else
    insert into community_reactions (post_id, user_id, value)
    values (p_post, auth.uid(), sign(p_value)::smallint)
    on conflict (post_id, user_id) do update set value = excluded.value;
  end if;
end;
$$;
grant execute on function public.community_vote(uuid, int) to authenticated;

create or replace function public.community_comments_of(p_post uuid)
returns table (
  id          uuid,
  author_id   uuid,
  author_name text,
  author_photo text,
  body        text,
  created_at  timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.author_id, coalesce(u.name, 'ORBII user'), u.photo_url, c.body, c.created_at
  from community_comments c
  left join users_public u on u.id = c.author_id
  where c.post_id = p_post
  order by c.created_at asc;
$$;
grant execute on function public.community_comments_of(uuid) to authenticated;
