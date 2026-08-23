import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Share,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { appAlert, useBrandSheet } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  addComment,
  avatarEmoji,
  blockProfile,
  createPost,
  deletePost,
  follow,
  getMyProfile,
  loadComments,
  loadFeed,
  reportPost,
  unfollow,
  votePost,
  ratePost,
  logAction,
  type PostRating,
  type CommunityCategory,
  type FeedComment,
  type FeedPost,
  type FeedTab,
} from '@/services/community-feed';
import { useIsPremium } from '@/services/entitlements';
import { useTabBarScroll } from '@/navigation/tabBarVisibility';

// Community, an anonymous, moderated space to share safety experiences.
// Your community identity is separate from your real account.

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CATEGORY_COLOR: Record<CommunityCategory, string> = {
  general: colors.textMuted,
  safety: colors.sageDeep,
  legal: colors.brandDeep,
  emergency: colors.coralDeep,
};

const TABS: { key: FeedTab; label: string }[] = [
  { key: 'explore', label: 'Explore' },
  { key: 'following', label: 'Following' },
  { key: 'mine', label: 'My Posts' },
];

const FILTERS: { key: CommunityCategory | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'safety', label: 'Safety' },
  { key: 'legal', label: 'Legal' },
  { key: 'emergency', label: 'Emergency' },
];

const COMPOSE_CATS: CommunityCategory[] = ['general', 'safety', 'legal', 'emergency'];

export function CommunityFeedScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const sheet = useBrandSheet();
  const isPremium = useIsPremium();
  const onTabScroll = useTabBarScroll();

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<FeedTab>('explore');
  const [cat, setCat] = useState<CommunityCategory | 'all'>('all');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState(false);

  // compose
  const [composeOpen, setComposeOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [composeCat, setComposeCat] = useState<CommunityCategory>('general');
  const [posting, setPosting] = useState(false);

  // per-post action sheet
  const [actionFor, setActionFor] = useState<FeedPost | null>(null);

  const refresh = useCallback(async () => {
    const [feed, mine] = await Promise.all([
      loadFeed(tab, cat === 'all' ? null : cat),
      getMyProfile(),
    ]);
    setPosts(feed);
    setHasProfile(!!mine);
    setLoading(false);
  }, [tab, cat]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void refresh();
    }, [refresh]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return posts;
    return posts.filter(
      (p) =>
        p.body.toLowerCase().includes(q) ||
        (p.title ?? '').toLowerCase().includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.handle.toLowerCase().includes(q),
    );
  }, [posts, query]);

  const openProfile = (profileId: string | null) => {
    if (profileId) (navigation as any).navigate('CommunityUserProfile', { profileId });
  };

  const openCompose = () => {
    if (!isPremium) {
      navigation.navigate('PremiumUpgrade' as never);
      return;
    }
    if (!hasProfile) {
      navigation.navigate('CommunityProfileSetup' as never);
      return;
    }
    setComposeOpen(true);
  };

  const submit = async () => {
    if (posting || (!title.trim() && !draft.trim())) return;
    setPosting(true);
    try {
      const res = await createPost(title, draft, composeCat);
      if (!res.ok) {
        appAlert("Couldn't post", res.error ?? 'Try again.');
        return;
      }
      setTitle('');
      setDraft('');
      setComposeCat('general');
      setComposeOpen(false);
      await refresh();
    } finally {
      setPosting(false);
    }
  };

  const vote = async (post: FeedPost) => {
    const value: 1 = 1;
    const cleared = post.myVote === value;
    setPosts((cur) =>
      cur.map((p) => {
        if (p.id !== post.id) return p;
        let ups = p.ups;
        if (p.myVote === 1) ups -= 1;
        if (!cleared) ups += 1;
        return { ...p, ups, myVote: (cleared ? 0 : 1) as -1 | 0 | 1 };
      }),
    );
    await votePost(post, 1);
  };

  // Rating drives the bridging model, so the optimistic update only touches
  // this user's own rating. The verdict itself is a property of everyone's
  // ratings together and arrives on the next load, which is honest: one tap
  // should not be able to stamp a post "helpful" on its own.
  const rate = async (post: FeedPost, rating: PostRating) => {
    const cleared = post.myRating === rating;
    setPosts((prev) =>
      prev.map((p) => {
        if (p.id !== post.id) return p;
        const wasHelpful = p.myRating === 'helpful';
        const nowHelpful = !cleared && rating === 'helpful';
        return {
          ...p,
          myRating: cleared ? null : rating,
          helpfulCount: Math.max(0, p.helpfulCount + (nowHelpful ? 1 : 0) - (wasHelpful ? 1 : 0)),
          ratedCount: Math.max(0, p.ratedCount + (p.myRating ? 0 : 1) - (cleared ? 1 : 0)),
        };
      }),
    );
    await ratePost(post, rating);
  };

  const sharePost = async (post: FeedPost) => {
    const title = post.title ? `${post.title}\n\n` : '';
    const verdict =
      post.bridgeStatus === 'helpful'
        ? '\n\nRated helpful by people who usually disagree, on ORBII.'
        : '\n\nShared from ORBII, a safety app for women in India.';
    try {
      await Share.share({
        message: `${title}${post.body}${verdict}\nhttps://www.orbii.in`,
      });
    } catch {
      // user dismissed the sheet
    }
  };

  const remove = (post: FeedPost) => {
    sheet.confirm({
      title: 'Delete your post?',
      body: 'This removes it for everyone. It cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete',
      icon: 'trash',
      onConfirm: async () => {
        await deletePost(post.id);
        await refresh();
      },
    });
  };

  const doReport = (post: FeedPost) => {
    setActionFor(null);
    sheet.confirm({
      title: 'Report this post?',
      body: 'An ORBII admin will review it. Posts with enough reports are hidden automatically.',
      confirmLabel: 'Report',
      icon: 'flag',
      onConfirm: async () => {
        await reportPost(post.id);
        appAlert('Reported', 'Thank you for keeping the community safe.');
      },
    });
  };

  const doBlock = (post: FeedPost) => {
    setActionFor(null);
    if (!post.authorProfileId) return;
    sheet.confirm({
      title: `Block ${post.displayName}?`,
      body: 'You will no longer see their posts, and they will not see yours.',
      destructive: true,
      confirmLabel: 'Block',
      icon: 'ban',
      onConfirm: async () => {
        await blockProfile(post.authorProfileId!);
        await refresh();
      },
    });
  };

  const toggleFollow = async (post: FeedPost) => {
    if (!post.authorProfileId) return;
    if (!hasProfile) {
      setActionFor(null);
      navigation.navigate('CommunityProfileSetup' as never);
      return;
    }
    const next = !post.isFollowing;
    setPosts((cur) => cur.map((p) => (p.authorProfileId === post.authorProfileId ? { ...p, isFollowing: next } : p)));
    setActionFor(null);
    if (next) await follow(post.authorProfileId);
    else await unfollow(post.authorProfileId);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Community</Text>
          <Pressable
            onPress={() =>
              isPremium
                ? navigation.navigate('CommunityProfileSetup' as never)
                : navigation.navigate('PremiumUpgrade' as never)
            }
            hitSlop={8}
            style={styles.headerBtn}
            accessibilityLabel="Your community profile"
          >
            <Ionicons name="person-circle-outline" size={26} color={colors.brandDeep} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          {TABS.map((t) => (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, tab === t.key && styles.tabOn]}>
              <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>

        <FlatList
          data={loading ? [] : shown}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          onScroll={onTabScroll}
          scrollEventThrottle={16}
          // Re-render rows when the open accordion or interaction gate changes;
          // the memo comparator lets only the affected cards through.
          extraData={`${openId ?? ''}|${hasProfile}`}
          removeClippedSubviews
          initialNumToRender={6}
          maxToRenderPerBatch={8}
          windowSize={11}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />}
          ListHeaderComponent={
            // A single wrapper with its own gap, a FlatList header is one cell,
            // so the list's contentContainer gap does NOT space these children;
            // this restores the vertical rhythm between banner, search and chips.
            <View style={styles.feedHeader}>
              {/* Moderation banner */}
              <View style={styles.banner}>
                <Text style={styles.bannerText}>Be respectful. Stay safe. All posts are anonymous and moderated 💜</Text>
              </View>

              {/* Search */}
              <View style={styles.search}>
                <Ionicons name="search" size={17} color={colors.textMuted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Search the community…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                />
              </View>

              {/* Category filter chips */}
              <View style={styles.chipsRow}>
                {FILTERS.map((f) => (
                  <Pressable key={f.key} onPress={() => setCat(f.key)} style={[styles.chip, cat === f.key && styles.chipOn]}>
                    <Text style={[styles.chipText, cat === f.key && styles.chipTextOn]}>{f.label}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
            ) : (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={34} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {tab === 'mine' ? "You haven't posted yet." : tab === 'following' ? 'No posts from people you follow.' : 'Nothing here yet.'}
                </Text>
                <Text style={styles.emptyHint}>Be the first to share something.</Text>
              </View>
            )
          }
          renderItem={({ item: p }) => (
            <PostCard
              post={p}
              open={openId === p.id}
              canInteract={hasProfile}
              onToggleComments={() => setOpenId(openId === p.id ? null : p.id)}
              onVote={() => vote(p)}
              onRate={(r) => rate(p, r)}
              onShare={() => sharePost(p)}
              onDelete={() => remove(p)}
              onMore={() => setActionFor(p)}
              onOpenAuthor={() => openProfile(p.authorProfileId)}
            />
          )}
        />

        <Pressable
          onPress={openCompose}
          style={[styles.fab, { bottom: insets.bottom + 102 }]}
          accessibilityRole="button"
          accessibilityLabel="Create a post"
        >
          <Ionicons name="create-outline" size={24} color={colors.textInverse} />
        </Pressable>
      </SafeAreaView>

      {/* Compose */}
      <Modal visible={composeOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Pressable onPress={() => setComposeOpen(false)} hitSlop={8}>
                <Text style={styles.sheetCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.sheetTitle}>New post</Text>
              <Pressable onPress={submit} disabled={posting || (!title.trim() && !draft.trim())} hitSlop={8}>
                <Text style={[styles.sheetPost, (posting || (!title.trim() && !draft.trim())) && { opacity: 0.4 }]}>
                  {posting ? 'Posting…' : 'Post'}
                </Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.composeCats}>
              {COMPOSE_CATS.map((c) => (
                <Pressable key={c} onPress={() => setComposeCat(c)} style={[styles.chip, composeCat === c && styles.chipOn]}>
                  <Text style={[styles.chipText, composeCat === c && styles.chipTextOn]}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title (optional)"
              placeholderTextColor={colors.textMuted}
              style={styles.titleInput}
              maxLength={120}
            />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Share your experience, ask a question, or offer support…"
              placeholderTextColor={colors.textMuted}
              style={styles.bodyInput}
              multiline
              maxLength={2000}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Per-post actions */}
      <Modal visible={!!actionFor} transparent animationType="fade" onRequestClose={() => setActionFor(null)}>
        <Pressable style={styles.actionRoot} onPress={() => setActionFor(null)}>
          <View style={styles.actionSheet}>
            {actionFor && !actionFor.isMine ? (
              <Pressable style={styles.actionRow} onPress={() => toggleFollow(actionFor)}>
                <Ionicons name={actionFor.isFollowing ? 'person-remove-outline' : 'person-add-outline'} size={19} color={colors.textPrimary} />
                <Text style={styles.actionText}>{actionFor.isFollowing ? 'Unfollow' : 'Follow'} {actionFor.displayName}</Text>
              </Pressable>
            ) : null}
            {actionFor && !actionFor.isMine ? (
              <Pressable style={styles.actionRow} onPress={() => doReport(actionFor)}>
                <Ionicons name="flag-outline" size={19} color={colors.textPrimary} />
                <Text style={styles.actionText}>Report post</Text>
              </Pressable>
            ) : null}
            {actionFor && !actionFor.isMine ? (
              <Pressable style={styles.actionRow} onPress={() => doBlock(actionFor)}>
                <Ionicons name="ban-outline" size={19} color={colors.coralDeep} />
                <Text style={[styles.actionText, { color: colors.coralDeep }]}>Block user</Text>
              </Pressable>
            ) : null}
            {actionFor && actionFor.isMine ? (
              <Pressable style={styles.actionRow} onPress={() => { const p = actionFor; setActionFor(null); remove(p); }}>
                <Ionicons name="trash-outline" size={19} color={colors.coralDeep} />
                <Text style={[styles.actionText, { color: colors.coralDeep }]}>Delete post</Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function PostCardBase({
  post,
  open,
  canInteract,
  onToggleComments,
  onVote,
  onRate,
  onShare,
  onDelete,
  onMore,
  onOpenAuthor,
}: {
  post: FeedPost;
  open: boolean;
  canInteract: boolean;
  onToggleComments: () => void;
  onVote: () => void;
  onRate: (rating: PostRating) => void;
  onShare: () => void;
  onDelete: () => void;
  onMore: () => void;
  onOpenAuthor: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Pressable onPress={onOpenAuthor} style={styles.authorTap} hitSlop={4}>
          <View style={styles.avatar}>
            <Text style={styles.avatarEmoji}>{avatarEmoji(post.avatarKey)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{post.displayName}</Text>
            <Text style={styles.handle} numberOfLines={1}>@{post.handle}</Text>
          </View>
        </Pressable>
        <View style={styles.metaRight}>
          <View style={styles.catPill}>
            <Text style={[styles.catText, { color: CATEGORY_COLOR[post.category] }]}>
              {post.category.charAt(0).toUpperCase() + post.category.slice(1)}
            </Text>
          </View>
          <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
        </View>
        <Pressable onPress={onMore} hitSlop={8} style={{ paddingLeft: 6 }}>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      {post.bridgeStatus === 'helpful' ? (
        <View style={styles.verdictHelpful}>
          <Ionicons name="people" size={13} color={colors.sageDeep} />
          <Text style={styles.verdictHelpfulText}>
            Found helpful by people who usually disagree
          </Text>
        </View>
      ) : post.bridgeStatus === 'not_helpful' ? (
        <View style={styles.verdictWeak}>
          <Ionicons name="alert-circle-outline" size={13} color={colors.textSecondary} />
          <Text style={styles.verdictWeakText}>Rated unhelpful by readers</Text>
        </View>
      ) : null}

      {post.title ? <Text style={styles.postTitle}>{post.title}</Text> : null}
      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      <View style={styles.actions}>
        <Pressable onPress={canInteract ? onVote : onMore} hitSlop={6} style={styles.actBtn}>
          <Ionicons
            name={post.myVote === 1 ? 'heart' : 'heart-outline'}
            size={20}
            color={post.myVote === 1 ? colors.coralDeep : colors.textPrimary}
          />
          <Text style={[styles.actCount, post.myVote === 1 && { color: colors.coralDeep }]}>{post.ups}</Text>
        </Pressable>
        <Pressable onPress={onToggleComments} hitSlop={6} style={styles.actBtn}>
          <Ionicons name="chatbubble-outline" size={18} color={colors.textPrimary} />
          <Text style={styles.actCount}>{post.commentCount}</Text>
        </Pressable>
        <Pressable onPress={onShare} hitSlop={6} style={styles.actBtn}>
          <Ionicons name="share-social-outline" size={19} color={colors.textPrimary} />
        </Pressable>
        {post.isFollowing && !post.isMine ? (
          <View style={styles.followingTag}>
            <Text style={styles.followingText}>Following</Text>
          </View>
        ) : null}
      </View>

      {/* Helpfulness. Deliberately separate from the heart above: a heart says
          "I liked this", these say "this is worth someone else's time", and only
          the second one should decide what the feed surfaces. */}
      {!post.isMine ? (
        <View style={styles.rateRow}>
          <Text style={styles.rateLabel}>
            {post.ratedCount >= 5
              ? `Is this helpful? ${post.helpfulCount} of ${post.ratedCount} said yes`
              : post.ratedCount > 0
                ? `Is this helpful? ${post.ratedCount} of 5 ratings so far`
                : 'Is this helpful?'}
          </Text>
          <View style={styles.rateBtns}>
            {([
              ['helpful', 'Yes'],
              ['somewhat', 'Somewhat'],
              ['not_helpful', 'No'],
            ] as [PostRating, string][]).map(([key, label]) => {
              const on = post.myRating === key;
              return (
                <Pressable
                  key={key}
                  onPress={canInteract ? () => onRate(key) : onMore}
                  style={[styles.rateBtn, on && styles.rateBtnOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                >
                  <Text style={[styles.rateBtnText, on && styles.rateBtnTextOn]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {open ? <Comments postId={post.id} canInteract={canInteract} /> : null}
    </View>
  );
}

// Memoized on DATA only: the comparator ignores the callback props (they're
// re-created inline per render), so a card only re-renders when its post,
// open, or canInteract actually changes. With the FlatList below, this keeps
// the feed smooth as it grows and while you type in search.
const PostCard = React.memo(
  PostCardBase,
  (prev, next) =>
    prev.post === next.post &&
    prev.open === next.open &&
    prev.canInteract === next.canInteract,
);

function Comments({ postId, canInteract }: { postId: string; canInteract: boolean }) {
  const [items, setItems] = useState<FeedComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);

  const load = useCallback(async () => setItems(await loadComments(postId)), [postId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // One level of nesting: top-level comments and their replies.
  const threads = useMemo(() => {
    const list = items ?? [];
    const tops = list.filter((c) => !c.parentId);
    const byParent = new Map<string, FeedComment[]>();
    for (const c of list) {
      if (!c.parentId) continue;
      const arr = byParent.get(c.parentId) ?? [];
      arr.push(c);
      byParent.set(c.parentId, arr);
    }
    return tops.map((t) => ({ comment: t, replies: byParent.get(t.id) ?? [] }));
  }, [items]);

  const send = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      const parentId = replyTo ? replyTo.parentId ?? replyTo.id : null;
      const ok = await addComment(postId, draft, parentId);
      if (ok) {
        setDraft('');
        setReplyTo(null);
        await load();
      } else {
        appAlert("Couldn't comment", 'Set up your community profile first.');
      }
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ c, isReply }: { c: FeedComment; isReply?: boolean }) => (
    <View style={[styles.commentRow, isReply && styles.replyRow]}>
      <View style={[styles.commentAvatar, isReply && styles.replyAvatar]}>
        <Text style={[styles.commentEmoji, isReply && { fontSize: 12 }]}>{avatarEmoji(c.avatarKey)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.commentName}>
          {c.displayName} · <Text style={styles.commentTime}>{timeAgo(c.createdAt)}</Text>
        </Text>
        <Text style={styles.commentBody}>{c.body}</Text>
        {canInteract && !isReply ? (
          <Pressable onPress={() => setReplyTo(c)} hitSlop={6}>
            <Text style={styles.replyLink}>Reply</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.comments}>
      {items === null ? (
        <ActivityIndicator color={colors.brand} style={{ paddingVertical: spacing.sm }} />
      ) : (
        threads.map(({ comment, replies }) => (
          <View key={comment.id}>
            <Row c={comment} />
            {replies.map((r) => <Row key={r.id} c={r} isReply />)}
          </View>
        ))
      )}

      {canInteract ? (
        <>
          {replyTo ? (
            <View style={styles.replyingBar}>
              <Text style={styles.replyingText} numberOfLines={1}>Replying to {replyTo.displayName}</Text>
              <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                <Ionicons name="close" size={15} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.commentCompose}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={replyTo ? `Reply to ${replyTo.displayName}…` : 'Add a comment…'}
              placeholderTextColor={colors.textMuted}
              style={styles.commentInput}
              maxLength={1000}
            />
            <Pressable onPress={send} disabled={busy || !draft.trim()} hitSlop={6}>
              <Ionicons name="send" size={18} color={draft.trim() ? colors.brand : colors.textMuted} />
            </Pressable>
          </View>
        </>
      ) : (
        <Text style={styles.readonlyHint}>Get ORBII Plus to comment and join the conversation.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  headerTitle: { ...typography.h2, fontSize: 22, color: colors.textPrimary },
  headerBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  tabs: {
    flexDirection: 'row',
    marginHorizontal: spacing.lg,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.pill,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill },
  tabOn: { backgroundColor: colors.surface, ...shadows.icon },
  tabText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },
  tabTextOn: { color: colors.brandDeep },

  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: 140, gap: spacing.md },

  banner: {
    backgroundColor: colors.lavenderSoft,
    borderRadius: radius.xl,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
  },
  bannerText: { fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.lavenderDeep, lineHeight: 16, textAlign: 'center' },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    ...shadows.icon,
  },
  searchInput: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textPrimary, paddingVertical: 11 },

  feedHeader: { gap: spacing.md, paddingBottom: spacing.xs },
  chipsRow: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.icon,
  },
  chipOn: { backgroundColor: colors.brand },
  chipText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
  chipTextOn: { color: colors.textInverse },

  empty: { alignItems: 'center', gap: 8, paddingVertical: spacing.xxl },
  emptyText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary, marginTop: spacing.sm },
  emptyHint: { ...typography.caption, fontSize: 12, color: colors.textMuted },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingVertical: 16, paddingHorizontal: 16, gap: 9, ...shadows.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  authorTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 20 },
  name: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textPrimary },
  handle: { fontFamily: fontFamilies.interRegular, fontSize: 11.5, color: colors.textMuted },
  metaRight: { alignItems: 'flex-end', gap: 2 },
  catPill: { backgroundColor: colors.creamDeep, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  catText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5 },
  time: { ...typography.caption, fontSize: 10.5, color: colors.textMuted },

  postTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.creamDeep },
  actCount: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textPrimary },
  verdictHelpful: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.sageSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  verdictHelpfulText: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.sageDeep,
  },
  verdictWeak: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: colors.creamDeep,
    borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5,
    marginBottom: spacing.sm,
  },
  verdictWeakText: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.textSecondary,
  },
  rateRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: 7,
  },
  rateLabel: {
    fontFamily: fontFamilies.poppinsRegular, fontSize: 12, color: colors.textSecondary,
  },
  rateBtns: { flexDirection: 'row', gap: 7 },
  rateBtn: {
    paddingHorizontal: 13, paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rateBtnOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  rateBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary,
  },
  rateBtnTextOn: { color: colors.textInverse },
  followingTag: { marginLeft: 'auto', backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  followingText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5, color: colors.brandDeep },

  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },

  sheetRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,20,30,0.35)' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  sheetTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  sheetCancel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },
  sheetPost: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.brand },
  composeCats: { gap: spacing.sm, paddingVertical: 2, marginBottom: spacing.xs },
  titleInput: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  bodyInput: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textPrimary, minHeight: 110, maxHeight: 220, textAlignVertical: 'top', paddingTop: spacing.sm },

  actionRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,20,30,0.35)' },
  actionSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingVertical: spacing.sm, paddingBottom: spacing.xxl },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 15 },
  actionText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },

  comments: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm, gap: spacing.sm },
  commentRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  commentAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.creamDeep, alignItems: 'center', justifyContent: 'center' },
  commentEmoji: { fontSize: 14 },
  commentName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },
  commentTime: { fontFamily: fontFamilies.interRegular, fontSize: 11, color: colors.textMuted },
  commentBody: { fontFamily: fontFamilies.interRegular, fontSize: 13.5, color: colors.textPrimary, marginTop: 1 },
  replyRow: { marginLeft: 34, marginTop: spacing.xs },
  replyAvatar: { width: 22, height: 22, borderRadius: 11 },
  replyLink: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.brandDeep, marginTop: 3 },
  replyingBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.brandSoft, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 6, marginBottom: 6 },
  replyingText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.brandDeep },
  commentCompose: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.cream, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4 },
  commentInput: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13.5, color: colors.textPrimary, paddingVertical: 8 },
  readonlyHint: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm },
});
