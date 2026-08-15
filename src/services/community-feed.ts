import { supabase } from './supabase';

// Community v2, an anonymous, moderated feed. Your community identity (handle,
// display name, gender, avatar) is SEPARATE from your real account. The server
// still knows the real author for moderation, but other users never do.
// Backed by sql/47_community_v2.sql.

export type CommunityCategory = 'general' | 'safety' | 'legal' | 'emergency';
export type Gender = 'female' | 'male' | 'nonbinary' | 'undisclosed';
export type FeedTab = 'explore' | 'following' | 'mine';

// Anonymous avatars the user picks from (no image assets needed).
export const AVATARS: Record<string, string> = {
  a1: '🦊', a2: '🐱', a3: '🐨', a4: '🐼', a5: '🦉',
  a6: '🐧', a7: '🦋', a8: '🌸', a9: '⭐', a10: '🌙',
  a11: '🐝', a12: '🐬',
};
export const AVATAR_KEYS = Object.keys(AVATARS);
export function avatarEmoji(key: string): string {
  return AVATARS[key] ?? '🦊';
}

export const CATEGORY_LABEL: Record<CommunityCategory, string> = {
  general: 'General', safety: 'Safety', legal: 'Legal', emergency: 'Emergency',
};

export type FeedPost = {
  id: string;
  authorProfileId: string | null;
  handle: string;
  displayName: string;
  gender: Gender;
  avatarKey: string;
  title: string | null;
  body: string;
  category: CommunityCategory;
  createdAt: string;
  ups: number;
  downs: number;
  commentCount: number;
  myVote: -1 | 0 | 1;
  isFollowing: boolean;
  isMine: boolean;
};

export type FeedComment = {
  id: string;
  parentId: string | null;
  authorProfileId: string | null;
  handle: string;
  displayName: string;
  gender: Gender;
  avatarKey: string;
  body: string;
  createdAt: string;
  isMine: boolean;
};

export type CommunityProfile = {
  id: string;
  handle: string;
  displayName: string;
  gender: Gender;
  avatarKey: string;
  bio: string | null;
  followers: number;
  following: number;
};

async function currentUid(): Promise<string | undefined> {
  return (await supabase.auth.getSession()).data.session?.user?.id;
}

// ---- Feed ----------------------------------------------------------------
export async function loadFeed(
  tab: FeedTab = 'explore',
  category: CommunityCategory | null = null,
  limit = 50,
  offset = 0,
): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('community_feed_v2', {
    p_tab: tab,
    p_category: category,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    authorProfileId: (r.author_profile_id as string) ?? null,
    handle: (r.handle as string) ?? 'orbii_user',
    displayName: (r.display_name as string) ?? 'ORBII user',
    gender: (r.gender as Gender) ?? 'undisclosed',
    avatarKey: (r.avatar_key as string) ?? 'a1',
    title: (r.title as string) ?? null,
    body: r.body as string,
    category: (r.category as CommunityCategory) ?? 'general',
    createdAt: r.created_at as string,
    ups: Number(r.ups ?? 0),
    downs: Number(r.downs ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    myVote: Number(r.my_vote ?? 0) as -1 | 0 | 1,
    isFollowing: Boolean(r.is_following),
    isMine: Boolean(r.is_mine),
  }));
}

export async function createPost(
  title: string,
  body: string,
  category: CommunityCategory = 'general',
): Promise<{ ok: boolean; error?: string; id?: string }> {
  const b = body.trim();
  const t = title.trim();
  if (t.length < 1 && b.length < 1) return { ok: false, error: 'Write something first.' };
  const { data, error } = await supabase.rpc('community_create_post', {
    p_title: t,
    p_body: b.length ? b : t,
    p_category: category,
  });
  if (error) {
    const msg = /profile first/i.test(error.message)
      ? 'Set up your community profile first.'
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true, id: data as string };
}

/** Toggle-aware vote: pass +1 / -1; re-tapping the same value clears it. */
export async function votePost(post: FeedPost, value: 1 | -1): Promise<void> {
  const next = post.myVote === value ? 0 : value;
  try {
    await supabase.rpc('community_vote', { p_post: post.id, p_value: next });
  } catch {
    // best-effort; UI reconciles on next load
  }
}

export async function deletePost(id: string): Promise<boolean> {
  const { error } = await supabase.from('community_posts').delete().eq('id', id);
  return !error;
}

export async function reportPost(id: string, reason?: string): Promise<boolean> {
  const u = await currentUid();
  if (!u) return false;
  const { error } = await supabase
    .from('community_reports')
    .insert({ post_id: id, reporter: u, reason: reason ?? null });
  return !error;
}

// ---- Comments (flat) -----------------------------------------------------
export async function loadComments(postId: string): Promise<FeedComment[]> {
  const { data, error } = await supabase.rpc('community_comments_v2', { p_post: postId });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string) ?? null,
    authorProfileId: (r.author_profile_id as string) ?? null,
    handle: (r.handle as string) ?? 'orbii_user',
    displayName: (r.display_name as string) ?? 'ORBII user',
    gender: (r.gender as Gender) ?? 'undisclosed',
    avatarKey: (r.avatar_key as string) ?? 'a1',
    body: r.body as string,
    createdAt: r.created_at as string,
    isMine: Boolean(r.is_mine),
  }));
}

export async function addComment(
  postId: string,
  body: string,
  parentId?: string | null,
): Promise<boolean> {
  const b = body.trim();
  if (!b) return false;
  const { error } = await supabase.rpc('community_add_comment', {
    p_post: postId,
    p_body: b,
    p_parent: parentId ?? null,
  });
  return !error;
}

// ---- Profiles ------------------------------------------------------------
export async function getMyProfile(): Promise<CommunityProfile | null> {
  const { data, error } = await supabase.rpc('community_profile_mine');
  if (error || !data || (data as unknown[]).length === 0) return null;
  const r = (data as Record<string, unknown>[])[0];
  return {
    id: r.id as string,
    handle: r.handle as string,
    displayName: r.display_name as string,
    gender: (r.gender as Gender) ?? 'undisclosed',
    avatarKey: (r.avatar_key as string) ?? 'a1',
    bio: (r.bio as string) ?? null,
    followers: Number(r.followers ?? 0),
    following: Number(r.following ?? 0),
  };
}

export async function upsertProfile(p: {
  handle: string;
  displayName: string;
  gender: Gender;
  avatarKey: string;
  bio?: string;
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { data, error } = await supabase.rpc('community_profile_upsert', {
    p_handle: p.handle,
    p_display_name: p.displayName,
    p_gender: p.gender,
    p_avatar_key: p.avatarKey,
    p_bio: p.bio ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data as string };
}

export type PublicProfile = {
  id: string;
  handle: string;
  displayName: string;
  gender: Gender;
  avatarKey: string;
  bio: string | null;
  followers: number;
  following: number;
  isFollowing: boolean;
  isBlocked: boolean;
  helped: number;
};

export async function getUserProfile(profileId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc('community_profile_public', { p_profile_id: profileId });
  if (error || !data || (data as unknown[]).length === 0) return null;
  const r = (data as Record<string, unknown>[])[0];
  return {
    id: r.id as string,
    handle: r.handle as string,
    displayName: r.display_name as string,
    gender: (r.gender as Gender) ?? 'undisclosed',
    avatarKey: (r.avatar_key as string) ?? 'a1',
    bio: (r.bio as string) ?? null,
    followers: Number(r.followers ?? 0),
    following: Number(r.following ?? 0),
    isFollowing: Boolean(r.is_following),
    isBlocked: Boolean(r.is_blocked),
    helped: Number(r.helped ?? 0),
  };
}

export type PostSort = 'newest' | 'oldest' | 'popular';

export async function loadUserPosts(
  profileId: string,
  sort: PostSort = 'newest',
  limit = 50,
  offset = 0,
): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('community_user_feed', {
    p_profile_id: profileId,
    p_sort: sort,
    p_limit: limit,
    p_offset: offset,
  });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    id: r.id as string,
    authorProfileId: (r.author_profile_id as string) ?? null,
    handle: (r.handle as string) ?? 'orbii_user',
    displayName: (r.display_name as string) ?? 'ORBII user',
    gender: (r.gender as Gender) ?? 'undisclosed',
    avatarKey: (r.avatar_key as string) ?? 'a1',
    title: (r.title as string) ?? null,
    body: r.body as string,
    category: (r.category as CommunityCategory) ?? 'general',
    createdAt: r.created_at as string,
    ups: Number(r.ups ?? 0),
    downs: Number(r.downs ?? 0),
    commentCount: Number(r.comment_count ?? 0),
    myVote: Number(r.my_vote ?? 0) as -1 | 0 | 1,
    isFollowing: Boolean(r.is_following),
    isMine: Boolean(r.is_mine),
  }));
}

export async function follow(profileId: string): Promise<void> {
  await supabase.rpc('community_follow', { p_target: profileId });
}
export async function unfollow(profileId: string): Promise<void> {
  await supabase.rpc('community_unfollow', { p_target: profileId });
}
export async function blockProfile(profileId: string): Promise<void> {
  await supabase.rpc('community_block', { p_target: profileId });
}
export async function unblockProfile(profileId: string): Promise<void> {
  await supabase.rpc('community_unblock', { p_target: profileId });
}
