import { supabase } from './supabase';

// Community feed — share safety experiences, up/down vote, comment. Mini forum.
// All reads/writes are RLS-gated and go through the SECURITY DEFINER RPCs in
// sql/42 so the client never has to stitch counts together itself.

export type FeedPost = {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string | null;
  body: string;
  createdAt: string;
  ups: number;
  downs: number;
  commentCount: number;
  myVote: -1 | 0 | 1;
};

export type FeedComment = {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string | null;
  body: string;
  createdAt: string;
};

export async function loadFeed(limit = 50, offset = 0): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('community_feed', {
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    authorId: r.author_id as string,
    authorName: (r.author_name as string) ?? 'ORBII user',
    authorPhoto: (r.author_photo as string) ?? null,
    body: r.body as string,
    createdAt: r.created_at as string,
    ups: Number(r.ups ?? 0),
    downs: Number(r.downs ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    myVote: (Number(r.my_vote ?? 0) as -1 | 0 | 1),
  }));
}

export async function createPost(body: string): Promise<{ ok: boolean; error?: string }> {
  const text = body.trim();
  if (text.length < 1) return { ok: false, error: 'Write something first.' };
  const uid = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!uid) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase
    .from('community_posts')
    .insert({ author_id: uid, body: text.slice(0, 2000) });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deletePost(id: string): Promise<boolean> {
  const { error } = await supabase.from('community_posts').delete().eq('id', id);
  return !error;
}

/** Toggle-aware vote: pass +1 / -1; re-tapping the same value clears it. */
export async function votePost(post: FeedPost, value: 1 | -1): Promise<void> {
  const next = post.myVote === value ? 0 : value;
  try {
    await supabase.rpc('community_vote', { p_post: post.id, p_value: next });
  } catch {
    // best-effort; the UI reconciles on the next load
  }
}

export async function loadComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase.rpc('community_comments_of', { p_post: postId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    authorId: r.author_id as string,
    authorName: (r.author_name as string) ?? 'ORBII user',
    authorPhoto: (r.author_photo as string) ?? null,
    body: r.body as string,
    createdAt: r.created_at as string,
  }));
}

export async function addComment(postId: string, body: string): Promise<boolean> {
  const text = body.trim();
  if (!text) return false;
  const uid = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('community_comments')
    .insert({ post_id: postId, author_id: uid, body: text.slice(0, 1000) });
  return !error;
}

export async function reportPost(postId: string, reason?: string): Promise<boolean> {
  const uid = (await supabase.auth.getSession()).data.session?.user?.id;
  if (!uid) return false;
  const { error } = await supabase
    .from('community_reports')
    .insert({ post_id: postId, reporter: uid, reason: reason ?? null });
  return !error;
}
