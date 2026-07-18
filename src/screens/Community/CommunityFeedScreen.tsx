import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { useAppSelector } from '@/redux/store';
import {
  addComment,
  createPost,
  deletePost,
  loadComments,
  loadFeed,
  reportPost,
  votePost,
  type FeedComment,
  type FeedPost,
} from '@/services/community-feed';
import { useIsPremium } from '@/services/entitlements';

// Community — a place to share safety experiences and support each other.
// Post, up/down vote, comment. Not anonymous to the server (every author is a
// real account), so abuse can be traced and removed.

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function CommunityFeedScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const sheet = useBrandSheet();
  const myUid = useAppSelector((s) => s.user.profile?.uid);
  const isPremium = useIsPremium();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [title, setTitle] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  const shown = filter === 'mine' ? posts.filter((p) => p.authorId === myUid) : posts;

  const refresh = useCallback(async () => {
    setPosts(await loadFeed());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  };

  const submit = async () => {
    if (posting || !title.trim()) return;
    setPosting(true);
    try {
      const res = await createPost(title, draft);
      if (!res.ok) {
        appAlert("Couldn't post", res.error ?? 'Try again.');
        return;
      }
      setTitle('');
      setDraft('');
      setComposeOpen(false);
      await refresh();
    } finally {
      setPosting(false);
    }
  };

  const openCompose = () => {
    if (!isPremium) {
      navigation.navigate('PremiumUpgrade' as never);
      return;
    }
    setComposeOpen(true);
  };

  // Optimistic vote: update the number immediately, reconcile on next load.
  const vote = async (post: FeedPost, value: 1 | -1) => {
    const cleared = post.myVote === value;
    setPosts((cur) =>
      cur.map((p) => {
        if (p.id !== post.id) return p;
        let ups = p.ups;
        let downs = p.downs;
        // remove previous
        if (p.myVote === 1) ups -= 1;
        if (p.myVote === -1) downs -= 1;
        const next = cleared ? 0 : value;
        if (next === 1) ups += 1;
        if (next === -1) downs += 1;
        return { ...p, ups, downs, myVote: next as -1 | 0 | 1 };
      }),
    );
    await votePost(post, value);
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

  const report = (post: FeedPost) => {
    sheet.confirm({
      title: 'Report this post?',
      body: 'An ORBII admin will review it. Thanks for keeping the community safe.',
      confirmLabel: 'Report',
      icon: 'flag',
      onConfirm: async () => {
        await reportPost(post.id);
        appAlert('Reported', 'Thank you. We’ll take a look.');
      },
    });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          {navigation.canGoBack() ? (
            <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
              <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
          <Text style={styles.headerTitle}>Community</Text>
          <View style={{ width: 40 }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
            }
          >
            {/* All / My posts filter */}
            <View style={styles.filterRow}>
              <Pressable onPress={() => setFilter('all')} style={[styles.filterBtn, filter === 'all' && styles.filterOn]}>
                <Text style={[styles.filterText, filter === 'all' && styles.filterTextOn]}>All posts</Text>
              </Pressable>
              <Pressable onPress={() => setFilter('mine')} style={[styles.filterBtn, filter === 'mine' && styles.filterOn]}>
                <Text style={[styles.filterText, filter === 'mine' && styles.filterTextOn]}>My posts</Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
            ) : shown.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={34} color={colors.textMuted} />
                <Text style={styles.emptyText}>
                  {filter === 'mine' ? "You haven't posted yet." : 'No posts yet.'}
                </Text>
                <Text style={styles.emptyHint}>
                  {filter === 'mine' ? 'Your posts will show here.' : 'Be the first to share something.'}
                </Text>
              </View>
            ) : (
              shown.map((p) => (
                <PostCard
                  key={p.id}
                  post={p}
                  mine={p.authorId === myUid}
                  open={openId === p.id}
                  onToggleComments={() => setOpenId(openId === p.id ? null : p.id)}
                  onVote={vote}
                  onDelete={() => remove(p)}
                  onReport={() => report(p)}
                />
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Create-post FAB (Reddit "+"). Lifted clear of the floating tab bar
            (its bar sits ~76px up from the bottom). Plus-gated. */}
        <Pressable
          onPress={openCompose}
          style={[styles.fab, { bottom: insets.bottom + 92 }]}
          accessibilityRole="button"
          accessibilityLabel="Create a post"
        >
          <Ionicons name="add" size={30} color={colors.textInverse} />
        </Pressable>
      </SafeAreaView>

      {/* Compose modal: title (heading) + body (description), Reddit-style. */}
      <Modal visible={composeOpen} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setComposeOpen(false)}>
        <KeyboardAvoidingView style={styles.composeRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.composeSheet}>
            <View style={styles.composeHead}>
              <Pressable onPress={() => setComposeOpen(false)} hitSlop={8}>
                <Text style={styles.composeCancel}>Cancel</Text>
              </Pressable>
              <Text style={styles.composeHeadTitle}>New post</Text>
              <Pressable onPress={submit} disabled={posting || !title.trim()} hitSlop={8}>
                <Text style={[styles.composePost, (!title.trim() || posting) && { opacity: 0.4 }]}>
                  {posting ? 'Posting…' : 'Post'}
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={colors.textMuted}
              style={styles.titleInput}
              maxLength={160}
            />
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Share your experience or a safety tip… (optional)"
              placeholderTextColor={colors.textMuted}
              style={styles.bodyInput}
              multiline
              maxLength={2000}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function PostCard({
  post,
  mine,
  open,
  onToggleComments,
  onVote,
  onDelete,
  onReport,
}: {
  post: FeedPost;
  mine: boolean;
  open: boolean;
  onToggleComments: () => void;
  onVote: (p: FeedPost, v: 1 | -1) => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  const initial = post.authorName.charAt(0).toUpperCase();
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.authorAvatar}>
          <Text style={styles.authorInitial}>{initial}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName}>{post.authorName}</Text>
          <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
        </View>
        <Pressable onPress={mine ? onDelete : onReport} hitSlop={8}>
          <Ionicons
            name={mine ? 'trash-outline' : 'flag-outline'}
            size={17}
            color={colors.textMuted}
          />
        </Pressable>
      </View>

      {post.title ? <Text style={styles.postTitle}>{post.title}</Text> : null}
      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      <View style={styles.actions}>
        <Pressable onPress={() => onVote(post, 1)} hitSlop={6} style={styles.voteBtn}>
          <Ionicons
            name={post.myVote === 1 ? 'arrow-up-circle' : 'arrow-up-circle-outline'}
            size={20}
            color={post.myVote === 1 ? colors.sageDeep : colors.textSecondary}
          />
          <Text style={[styles.voteCount, post.myVote === 1 && { color: colors.sageDeep }]}>
            {post.ups}
          </Text>
        </Pressable>
        <Pressable onPress={() => onVote(post, -1)} hitSlop={6} style={styles.voteBtn}>
          <Ionicons
            name={post.myVote === -1 ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
            size={20}
            color={post.myVote === -1 ? colors.coralDeep : colors.textSecondary}
          />
          <Text style={[styles.voteCount, post.myVote === -1 && { color: colors.coralDeep }]}>
            {post.downs}
          </Text>
        </Pressable>
        <Pressable onPress={onToggleComments} hitSlop={6} style={styles.voteBtn}>
          <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
          <Text style={styles.voteCount}>{post.commentCount}</Text>
        </Pressable>
      </View>

      {open ? <Comments postId={post.id} /> : null}
    </View>
  );
}

function Comments({ postId }: { postId: string }) {
  const [items, setItems] = useState<FeedComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // When set, the next send is a REPLY to this comment.
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null);

  const load = useCallback(async () => setItems(await loadComments(postId)), [postId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Group into top-level comments + their replies.
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
      // A reply attaches to its thread's TOP comment so nesting stays one level.
      const parentId = replyTo ? replyTo.parentId ?? replyTo.id : null;
      const ok = await addComment(postId, draft, parentId);
      if (ok) {
        setDraft('');
        setReplyTo(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const CommentRow = ({ c, isReply }: { c: FeedComment; isReply?: boolean }) => (
    <View style={[styles.commentRow, isReply && styles.replyRow]}>
      <View style={[styles.commentAvatar, isReply && styles.replyAvatar]}>
        <Text style={styles.commentInitial}>{c.authorName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.commentName}>
          {c.authorName} · <Text style={styles.commentTime}>{timeAgo(c.createdAt)}</Text>
        </Text>
        <Text style={styles.commentBody}>{c.body}</Text>
        {!isReply ? (
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
        threads.map(({ comment, replies }: { comment: FeedComment; replies: FeedComment[] }) => (
          <View key={comment.id}>
            <CommentRow c={comment} />
            {replies.map((r) => (
              <CommentRow key={r.id} c={r} isReply />
            ))}
          </View>
        ))
      )}

      {replyTo ? (
        <View style={styles.replyingBar}>
          <Text style={styles.replyingText} numberOfLines={1}>
            Replying to {replyTo.authorName}
          </Text>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Ionicons name="close" size={15} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}

      <View style={styles.commentCompose}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={replyTo ? `Reply to ${replyTo.authorName}…` : 'Add a comment…'}
          placeholderTextColor={colors.textMuted}
          style={styles.commentInput}
          maxLength={1000}
        />
        <Pressable onPress={send} disabled={busy || !draft.trim()} hitSlop={6}>
          <Ionicons name="send" size={19} color={draft.trim() ? colors.brand : colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  headerTitle: { ...typography.h2, fontSize: 17, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 130, gap: spacing.md },

  compose: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    marginTop: spacing.sm,
    ...shadows.card,
  },
  input: {
    minHeight: 44,
    maxHeight: 130,
    fontFamily: fontFamilies.interMedium,
    fontSize: 14.5,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  postBtn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
  },
  postBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textInverse },

  gate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  gateIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  gateTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 13.5, color: colors.textPrimary },
  gateSub: { ...typography.caption, fontSize: 11, color: colors.textSecondary, marginTop: 1, lineHeight: 15 },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.pill,
    padding: 4,
  },
  filterBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.pill },
  filterOn: { backgroundColor: colors.surface, ...shadows.icon },
  filterText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },
  filterTextOn: { color: colors.brandDeep },
  empty: { alignItems: 'center', gap: 8, paddingVertical: spacing.xxl },
  emptyText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyHint: { ...typography.caption, fontSize: 12, color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  authorAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  authorInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.brandDeep },
  authorName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  time: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  postTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 16.5, color: colors.textPrimary, letterSpacing: -0.2, lineHeight: 22 },
  body: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },

  fab: {
    position: 'absolute',
    right: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.brand,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  composeRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20,20,30,0.35)' },
  composeSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  composeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  composeHeadTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  composeCancel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },
  composePost: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.brand },
  titleInput: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  bodyInput: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14.5,
    color: colors.textPrimary,
    minHeight: 100,
    maxHeight: 220,
    textAlignVertical: 'top',
    paddingTop: spacing.sm,
  },

  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  voteBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voteCount: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },

  comments: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  commentRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  commentAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 12, color: colors.textSecondary },
  commentName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },
  commentTime: { fontFamily: fontFamilies.interRegular, fontSize: 11, color: colors.textMuted },
  commentBody: { fontFamily: fontFamilies.interRegular, fontSize: 13.5, color: colors.textPrimary, marginTop: 1 },
  replyRow: { marginLeft: 34, marginTop: spacing.xs },
  replyAvatar: { width: 22, height: 22, borderRadius: 11 },
  replyLink: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.brandDeep, marginTop: 3 },
  replyingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  replyingText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.brandDeep },
  commentCompose: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cream,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  commentInput: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13.5,
    color: colors.textPrimary,
    paddingVertical: 8,
  },
});
