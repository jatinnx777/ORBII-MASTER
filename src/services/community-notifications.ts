import { supabase } from './supabase';

// In-app-only Community activity notifications (likes, comments, replies).
// These are read into the app's own Notifications screen, never pushed to the
// phone's system tray. Populated server-side by triggers (sql/50).

export type CommunityNotifType = 'like' | 'comment' | 'reply';

export type CommunityNotification = {
  id: string;
  type: CommunityNotifType;
  postId: string | null;
  commentId: string | null;
  read: boolean;
  createdAt: number;
  actorHandle: string | null;
  actorName: string | null;
  actorAvatar: string | null;
  postTitle: string | null;
  postSnippet: string | null;
};

type Row = {
  id: string;
  type: CommunityNotifType;
  post_id: string | null;
  comment_id: string | null;
  read: boolean;
  created_at: string | null;
  actor_handle: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  post_title: string | null;
  post_snippet: string | null;
};

export async function loadCommunityNotifications(limit = 40, offset = 0): Promise<CommunityNotification[]> {
  const { data, error } = await supabase.rpc('community_notifications_list', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return [];
  return (data as Row[]).map((r) => ({
    id: r.id,
    type: r.type,
    postId: r.post_id ?? null,
    commentId: r.comment_id ?? null,
    read: !!r.read,
    createdAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    actorHandle: r.actor_handle ?? null,
    actorName: r.actor_name ?? null,
    actorAvatar: r.actor_avatar ?? null,
    postTitle: r.post_title ?? null,
    postSnippet: r.post_snippet ?? null,
  }));
}

export async function markCommunityNotificationsRead(): Promise<void> {
  try {
    await supabase.rpc('community_notifications_mark_read');
  } catch {
    // best effort
  }
}

export async function communityUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('community_notifications_unread_count');
  if (error || typeof data !== 'number') return 0;
  return data;
}

/** Human sentence for a notification row, using the actor's anon identity. */
export function describeCommunityNotification(n: CommunityNotification): { title: string; body: string } {
  const who = n.actorName || (n.actorHandle ? `@${n.actorHandle}` : 'Someone');
  const post = n.postTitle ? `"${n.postTitle}"` : 'your post';
  switch (n.type) {
    case 'like':
      return { title: `${who} liked your post`, body: post };
    case 'comment':
      return { title: `${who} commented on your post`, body: n.postSnippet || post };
    case 'reply':
      return { title: `${who} replied to you`, body: n.postSnippet || post };
    default:
      return { title: `${who} interacted with your post`, body: post };
  }
}
