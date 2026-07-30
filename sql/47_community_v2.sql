-- 47_community_v2.sql
-- ============================================================================
-- Community v2: anonymous public identities, follows, blocks, categories,
-- a "hot" ranking algorithm, and auto-moderation. Builds ON TOP of 42.
--
-- Identity model (privacy-critical):
--   * community_profiles is a SEPARATE public identity from the user's account.
--   * Only handle, display_name, gender, and a chosen avatar are ever shown.
--   * The real name/photo/phone are NEVER exposed. user_id is NEVER returned by
--     any public RPC, so a handle can't be traced back to a real account.
--   * The SERVER still knows the real author (community_posts.author_id) so
--     admins can moderate. Anonymous to other users, accountable to us.
--
-- Access model: free users can READ. Posting/commenting/following requires a
-- community_profile, which the app only lets you create after buying Plus. (A
-- future migration can also hard-check premium server-side once the billing
-- webhook writes an is_premium flag we can trust.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Anonymous public identity
-- ---------------------------------------------------------------------------
create table if not exists community_profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  handle       text not null unique check (handle ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 30),
  gender       text not null check (gender in ('female','male','nonbinary','undisclosed')),
  avatar_key   text not null default 'a1',
  bio          text check (char_length(bio) <= 160),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table community_profiles enable row level security;

-- Only the owner can read/edit their OWN row directly. Everyone else sees a
-- profile ONLY through the SECURITY DEFINER RPCs below, which never leak user_id.
drop policy if exists "cp owner select" on community_profiles;
create policy "cp owner select" on community_profiles
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "cp owner upsert" on community_profiles;
create policy "cp owner insert" on community_profiles
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "cp owner update" on community_profiles;
create policy "cp owner update" on community_profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Helper: the caller's community profile id (or null). Used everywhere.
create or replace function public.community_my_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from community_profiles where user_id = auth.uid();
$$;
grant execute on function public.community_my_profile_id() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Follows & blocks
-- ---------------------------------------------------------------------------
create table if not exists community_follows (
  follower_id uuid not null references community_profiles(id) on delete cascade,
  followed_id uuid not null references community_profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followed_id),
  check (follower_id <> followed_id)
);
alter table community_follows enable row level security;
drop policy if exists "follows read" on community_follows;
create policy "follows read" on community_follows for select to authenticated using (true);
drop policy if exists "follows write self" on community_follows;
create policy "follows write self" on community_follows
  for all to authenticated
  using (follower_id = community_my_profile_id())
  with check (follower_id = community_my_profile_id());

create table if not exists community_blocks (
  blocker_id uuid not null references community_profiles(id) on delete cascade,
  blocked_id uuid not null references community_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table community_blocks enable row level security;
drop policy if exists "blocks self" on community_blocks;
create policy "blocks self" on community_blocks
  for all to authenticated
  using (blocker_id = community_my_profile_id())
  with check (blocker_id = community_my_profile_id());

-- ---------------------------------------------------------------------------
-- 3. Extend posts: anonymous author, category, title, moderation flag
-- ---------------------------------------------------------------------------
alter table community_posts add column if not exists author_profile_id uuid references community_profiles(id) on delete set null;
alter table community_posts add column if not exists title    text check (char_length(title) <= 120);
alter table community_posts add column if not exists category text not null default 'general'
  check (category in ('general','safety','legal','emergency'));
alter table community_posts add column if not exists hidden   boolean not null default false;
create index if not exists community_posts_cat_idx on community_posts (category, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Auto-moderation: hide a post once it crosses a report threshold
-- ---------------------------------------------------------------------------
create or replace function public.community_autohide()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from community_reports where post_id = new.post_id) >= 3 then
    update community_posts set hidden = true where id = new.post_id;
  end if;
  return new;
end;
$$;
drop trigger if exists community_autohide_trg on community_reports;
create trigger community_autohide_trg after insert on community_reports
  for each row execute function public.community_autohide();

-- ---------------------------------------------------------------------------
-- 5. Ranking: a "hot" score. Engagement (votes + a fraction of comments)
--    decayed by age (gravity 1.5, like Hacker News). Higher = ranks first.
-- ---------------------------------------------------------------------------
create or replace function public.community_hot(p_ups bigint, p_downs bigint, p_comments bigint, p_created timestamptz)
returns double precision language sql immutable as $$
  select ( (p_ups - p_downs)::double precision + 0.5 * p_comments + 1.0 )
         / power( (extract(epoch from (now() - p_created)) / 3600.0) + 2.0, 1.5 );
$$;

-- ---------------------------------------------------------------------------
-- 6. The feed, v2. tab: 'explore' | 'following' | 'mine'. Optional category.
--    Returns the ANONYMOUS identity, ranked hot, excluding hidden posts and
--    anyone the caller blocked (or who blocked the caller).
-- ---------------------------------------------------------------------------
create or replace function public.community_feed_v2(
  p_tab text default 'explore',
  p_category text default null,
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
  with me as (select community_my_profile_id() as pid)
  select
    p.id,
    p.author_profile_id,
    coalesce(cp.handle, 'orbii_user') as handle,
    coalesce(cp.display_name, 'ORBII user') as display_name,
    coalesce(cp.gender, 'undisclosed') as gender,
    coalesce(cp.avatar_key, 'a1') as avatar_key,
    p.title,
    p.body,
    p.category,
    p.created_at,
    coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0) as ups,
    coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0) as downs,
    coalesce((select count(*) from community_comments c where c.post_id = p.id), 0) as comment_count,
    (select r.value from community_reactions r where r.post_id = p.id and r.user_id = auth.uid()) as my_vote,
    exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = p.author_profile_id) as is_following,
    (p.author_id = auth.uid()) as is_mine
  from community_posts p
  left join community_profiles cp on cp.id = p.author_profile_id
  where
    (p_category is null or p.category = p_category)
    and (
      case p_tab
        when 'mine' then p.author_id = auth.uid()
        when 'following' then p.author_profile_id in (
          select f.followed_id from community_follows f where f.follower_id = (select pid from me)
        )
        else true
      end
    )
    -- hide moderated posts (except from their own author)
    and (not p.hidden or p.author_id = auth.uid())
    -- exclude blocked either direction
    and not exists (
      select 1 from community_blocks b
      where (b.blocker_id = (select pid from me) and b.blocked_id = p.author_profile_id)
         or (b.blocked_id = (select pid from me) and b.blocker_id = p.author_profile_id)
    )
  order by
    case when p_tab = 'mine' then extract(epoch from p.created_at) else null end desc nulls last,
    community_hot(
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = 1), 0),
      coalesce((select count(*) from community_reactions r where r.post_id = p.id and r.value = -1), 0),
      coalesce((select count(*) from community_comments c where c.post_id = p.id), 0),
      p.created_at
    ) desc
  limit greatest(1, least(p_limit, 100))
  offset greatest(0, p_offset);
$$;
grant execute on function public.community_feed_v2(text, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Create a post — GATE: caller must have a community_profile.
-- ---------------------------------------------------------------------------
create or replace function public.community_create_post(p_title text, p_body text, p_category text default 'general')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_id uuid;
begin
  v_pid := community_my_profile_id();
  if v_pid is null then
    raise exception 'Set up your community profile first' using errcode = '42501';
  end if;
  if coalesce(p_category, 'general') not in ('general','safety','legal','emergency') then
    p_category := 'general';
  end if;
  -- simple rate limit: no more than 1 post per 20 seconds
  if exists (select 1 from community_posts where author_id = auth.uid() and created_at > now() - interval '20 seconds') then
    raise exception 'You are posting too fast. Wait a moment.' using errcode = 'P0001';
  end if;
  insert into community_posts (author_id, author_profile_id, title, body, category)
  values (auth.uid(), v_pid, nullif(trim(p_title), ''), trim(p_body), p_category)
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.community_create_post(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Comment (gated) + comments listing with anonymous identity
-- ---------------------------------------------------------------------------
alter table community_comments add column if not exists author_profile_id uuid references community_profiles(id) on delete set null;

create or replace function public.community_add_comment(p_post uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pid uuid; v_id uuid;
begin
  v_pid := community_my_profile_id();
  if v_pid is null then
    raise exception 'Set up your community profile first' using errcode = '42501';
  end if;
  insert into community_comments (post_id, author_id, author_profile_id, body)
  values (p_post, auth.uid(), v_pid, trim(p_body))
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.community_add_comment(uuid, text) to authenticated;

create or replace function public.community_comments_v2(p_post uuid)
returns table (
  id uuid, author_profile_id uuid, handle text, display_name text,
  gender text, avatar_key text, body text, created_at timestamptz, is_mine boolean
)
language sql security definer set search_path = public stable as $$
  select c.id, c.author_profile_id,
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
-- 9. Profile RPCs (never leak user_id)
-- ---------------------------------------------------------------------------
create or replace function public.community_profile_mine()
returns table (id uuid, handle text, display_name text, gender text, avatar_key text, bio text,
               followers bigint, following bigint)
language sql security definer set search_path = public stable as $$
  select cp.id, cp.handle, cp.display_name, cp.gender, cp.avatar_key, cp.bio,
         (select count(*) from community_follows f where f.followed_id = cp.id),
         (select count(*) from community_follows f where f.follower_id = cp.id)
  from community_profiles cp where cp.user_id = auth.uid();
$$;
grant execute on function public.community_profile_mine() to authenticated;

create or replace function public.community_profile_upsert(
  p_handle text, p_display_name text, p_gender text, p_avatar_key text, p_bio text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_handle text;
begin
  v_handle := lower(trim(p_handle));
  if v_handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Handle must be 3-20 letters, numbers or underscores.' using errcode = 'P0001';
  end if;
  if p_gender not in ('female','male','nonbinary','undisclosed') then
    raise exception 'Pick a valid gender option.' using errcode = 'P0001';
  end if;
  -- handle taken by someone else?
  if exists (select 1 from community_profiles where handle = v_handle and user_id <> auth.uid()) then
    raise exception 'That handle is taken.' using errcode = '23505';
  end if;
  insert into community_profiles (user_id, handle, display_name, gender, avatar_key, bio)
  values (auth.uid(), v_handle, trim(p_display_name), p_gender, coalesce(nullif(trim(p_avatar_key),''),'a1'), nullif(trim(p_bio),''))
  on conflict (user_id) do update
    set handle = excluded.handle, display_name = excluded.display_name, gender = excluded.gender,
        avatar_key = excluded.avatar_key, bio = excluded.bio, updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
grant execute on function public.community_profile_upsert(text, text, text, text, text) to authenticated;

create or replace function public.community_profile_public(p_profile_id uuid)
returns table (id uuid, handle text, display_name text, gender text, avatar_key text, bio text,
               followers bigint, following bigint, is_following boolean, is_blocked boolean)
language sql security definer set search_path = public stable as $$
  with me as (select community_my_profile_id() as pid)
  select cp.id, cp.handle, cp.display_name, cp.gender, cp.avatar_key, cp.bio,
         (select count(*) from community_follows f where f.followed_id = cp.id),
         (select count(*) from community_follows f where f.follower_id = cp.id),
         exists (select 1 from community_follows f where f.follower_id = (select pid from me) and f.followed_id = cp.id),
         exists (select 1 from community_blocks b where b.blocker_id = (select pid from me) and b.blocked_id = cp.id)
  from community_profiles cp where cp.id = p_profile_id;
$$;
grant execute on function public.community_profile_public(uuid) to authenticated;

-- follow / unfollow / block / unblock (all keyed to the caller's profile)
create or replace function public.community_follow(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := community_my_profile_id();
  if v_pid is null then raise exception 'Set up your community profile first' using errcode='42501'; end if;
  if v_pid = p_target then return; end if;
  insert into community_follows (follower_id, followed_id) values (v_pid, p_target)
    on conflict do nothing;
end; $$;
grant execute on function public.community_follow(uuid) to authenticated;

create or replace function public.community_unfollow(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from community_follows where follower_id = community_my_profile_id() and followed_id = p_target;
end; $$;
grant execute on function public.community_unfollow(uuid) to authenticated;

create or replace function public.community_block(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_pid uuid;
begin
  v_pid := community_my_profile_id();
  if v_pid is null then raise exception 'Set up your community profile first' using errcode='42501'; end if;
  if v_pid = p_target then return; end if;
  insert into community_blocks (blocker_id, blocked_id) values (v_pid, p_target) on conflict do nothing;
  delete from community_follows where (follower_id = v_pid and followed_id = p_target)
                                    or (follower_id = p_target and followed_id = v_pid);
end; $$;
grant execute on function public.community_block(uuid) to authenticated;

create or replace function public.community_unblock(p_target uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from community_blocks where blocker_id = community_my_profile_id() and blocked_id = p_target;
end; $$;
grant execute on function public.community_unblock(uuid) to authenticated;
