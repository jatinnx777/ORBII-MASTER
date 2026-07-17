-- 43_comment_replies.sql
-- ============================================================================
-- Threaded replies on community comments. A comment can now point at a parent
-- comment (one level of nesting — a reply to a reply still hangs off the same
-- top-level comment, which keeps threads readable on a phone).
-- ============================================================================

alter table community_comments
  add column if not exists parent_id uuid references community_comments(id) on delete cascade;

create index if not exists community_comments_parent_idx on community_comments (parent_id);

-- Return parent_id so the client can group replies under their comment.
-- Drop first: the return columns changed (added parent_id), and Postgres won't
-- CREATE OR REPLACE across a changed return type.
drop function if exists public.community_comments_of(uuid);
create or replace function public.community_comments_of(p_post uuid)
returns table (
  id          uuid,
  parent_id   uuid,
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
  select c.id, c.parent_id, c.author_id, coalesce(u.name, 'ORBII user'), u.photo_url, c.body, c.created_at
  from community_comments c
  left join users_public u on u.id = c.author_id
  where c.post_id = p_post
  order by c.created_at asc;
$$;
grant execute on function public.community_comments_of(uuid) to authenticated;
