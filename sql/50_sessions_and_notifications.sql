-- 50_sessions_and_notifications.sql
--
-- Two features, run this whole file once in the Supabase SQL editor.
--
--  (A) SINGLE ACTIVE DEVICE PER ACCOUNT
--      One user_sessions row per user holds the device id that is currently
--      signed in. Opening the app claims this device; the previous device,
--      listening over Realtime, sees the row change and signs itself out.
--
--  (B) IN-APP COMMUNITY NOTIFICATIONS (no push)
--      Likes, comments and replies create a community_notifications row via
--      triggers. The app reads them into its own Notifications screen. Nothing
--      is ever sent to the phone's system notification tray.


-- ═══════════════════════════════════════════════════════════════════════════
--  (A) Single active device
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists user_sessions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  device_id    text not null,
  device_label text,
  updated_at   timestamptz not null default now()
);

alter table user_sessions enable row level security;

-- A user may read only their own session row (also what Realtime needs to
-- deliver the change event to the evicted device).
drop policy if exists user_sessions_select_own on user_sessions;
create policy user_sessions_select_own on user_sessions
  for select using (user_id = auth.uid());

-- No direct insert/update/delete policies: writes go through claim_session()
-- only, so a client can never point another user's session at their device.

-- Publish the table to Realtime (idempotent).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_sessions'
  ) then
    alter publication supabase_realtime add table user_sessions;
  end if;
end $$;

-- Claim this device as the account's one active device. Overwriting the row is
-- exactly what evicts whatever device was here before.
create or replace function public.claim_session(p_device_id text, p_label text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into user_sessions (user_id, device_id, device_label, updated_at)
  values (auth.uid(), p_device_id, p_label, now())
  on conflict (user_id) do update
    set device_id = excluded.device_id,
        device_label = excluded.device_label,
        updated_at = now();
end;
$$;

grant execute on function public.claim_session(text, text) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
--  (B) In-app community notifications
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists community_notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_profile_id  uuid references community_profiles(id) on delete set null,
  type              text not null check (type in ('like', 'comment', 'reply')),
  post_id           uuid references community_posts(id) on delete cascade,
  comment_id        uuid references community_comments(id) on delete cascade,
  read              boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists community_notifications_recipient_idx
  on community_notifications (recipient_user_id, created_at desc);

alter table community_notifications enable row level security;

drop policy if exists community_notifications_select_own on community_notifications;
create policy community_notifications_select_own on community_notifications
  for select using (recipient_user_id = auth.uid());

drop policy if exists community_notifications_update_own on community_notifications;
create policy community_notifications_update_own on community_notifications
  for update using (recipient_user_id = auth.uid());

-- Rows are only ever inserted by the SECURITY DEFINER triggers below, so no
-- insert policy is granted to clients.

-- A like (reaction value = 1) on a post → tell the post's author. Self-likes
-- and duplicate likes are skipped.
create or replace function public.community_notify_reaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author uuid;
  v_actor_profile uuid;
begin
  if new.value <> 1 then
    return new;
  end if;

  select author_id into v_author from community_posts where id = new.post_id;
  if v_author is null or v_author = new.user_id then
    return new;
  end if;

  select id into v_actor_profile from community_profiles where user_id = new.user_id;

  if not exists (
    select 1 from community_notifications
    where recipient_user_id = v_author
      and post_id = new.post_id
      and actor_profile_id is not distinct from v_actor_profile
      and type = 'like'
  ) then
    insert into community_notifications (recipient_user_id, actor_profile_id, type, post_id)
    values (v_author, v_actor_profile, 'like', new.post_id);
  end if;

  return new;
end;
$$;

drop trigger if exists community_notify_reaction_trg on community_reactions;
create trigger community_notify_reaction_trg
  after insert on community_reactions
  for each row execute function public.community_notify_reaction();

-- A comment notifies the post author; a reply (parent_id set) notifies the
-- parent comment's author instead. Self-actions are skipped.
create or replace function public.community_notify_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipient uuid;
begin
  if new.parent_id is null then
    select author_id into v_recipient from community_posts where id = new.post_id;
    if v_recipient is not null and v_recipient <> new.author_id then
      insert into community_notifications (recipient_user_id, actor_profile_id, type, post_id, comment_id)
      values (v_recipient, new.author_profile_id, 'comment', new.post_id, new.id);
    end if;
  else
    select author_id into v_recipient from community_comments where id = new.parent_id;
    if v_recipient is not null and v_recipient <> new.author_id then
      insert into community_notifications (recipient_user_id, actor_profile_id, type, post_id, comment_id)
      values (v_recipient, new.author_profile_id, 'reply', new.post_id, new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists community_notify_comment_trg on community_comments;
create trigger community_notify_comment_trg
  after insert on community_comments
  for each row execute function public.community_notify_comment();

-- Read the signed-in user's notifications, newest first, joined to the actor's
-- anonymous identity and the post it concerns.
create or replace function public.community_notifications_list(p_limit int default 40, p_offset int default 0)
returns table (
  id uuid,
  type text,
  post_id uuid,
  comment_id uuid,
  read boolean,
  created_at timestamptz,
  actor_handle text,
  actor_name text,
  actor_avatar text,
  post_title text,
  post_snippet text
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.type, n.post_id, n.comment_id, n.read, n.created_at,
         cp.handle, cp.display_name, cp.avatar_key,
         p.title, left(coalesce(p.body, ''), 80)
  from community_notifications n
  left join community_profiles cp on cp.id = n.actor_profile_id
  left join community_posts p on p.id = n.post_id
  where n.recipient_user_id = auth.uid()
  order by n.created_at desc
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

grant execute on function public.community_notifications_list(int, int) to authenticated;

create or replace function public.community_notifications_mark_read()
returns void
language sql
security definer
set search_path = public
as $$
  update community_notifications
    set read = true
  where recipient_user_id = auth.uid() and read = false;
$$;

grant execute on function public.community_notifications_mark_read() to authenticated;

create or replace function public.community_notifications_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from community_notifications
  where recipient_user_id = auth.uid() and read = false;
$$;

grant execute on function public.community_notifications_unread_count() to authenticated;

