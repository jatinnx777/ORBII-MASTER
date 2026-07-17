import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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
import { SafeAreaView } from 'react-native-safe-area-context';
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
  const sheet = useBrandSheet();
  const myUid = useAppSelector((s) => s.user.profile?.uid);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

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
    if (posting || !draft.trim()) return;
    setPosting(true);
    try {
      const res = await createPost(draft);
      if (!res.ok) {
        appAlert("Couldn't post", res.error ?? 'Try again.');
        return;
      }
      setDraft('');
      await refresh();
    } finally {
      setPosting(false);
    }
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
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
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
            {/* compose */}
            <View style={styles.compose}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Share an experience or a safety tip…"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                multiline
                maxLength={2000}
              />
              <Pressable
                onPress={submit}
                disabled={posting || !draft.trim()}
                style={({ pressed }) => [
                  styles.postBtn,
                  (!draft.trim() || posting) && { opacity: 0.5 },
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Text style={styles.postBtnText}>{posting ? 'Posting…' : 'Post'}</Text>
              </Pressable>
            </View>

            {loading ? (
              <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
            ) : posts.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="chatbubbles-outline" size={34} color={colors.textMuted} />
                <Text style={styles.emptyText}>No posts yet.</Text>
                <Text style={styles.emptyHint}>Be the first to share something.</Text>
              </View>
            ) : (
              posts.map((p) => (
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
      </SafeAreaView>
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

      <Text style={styles.body}>{post.body}</Text>

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

  const load = useCallback(async () => setItems(await loadComments(postId)), [postId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const send = async () => {
    if (busy || !draft.trim()) return;
    setBusy(true);
    try {
      const ok = await addComment(postId, draft);
      if (ok) {
        setDraft('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.comments}>
      {items === null ? (
        <ActivityIndicator color={colors.brand} style={{ paddingVertical: spacing.sm }} />
      ) : (
        items.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <View style={styles.commentAvatar}>
              <Text style={styles.commentInitial}>{c.authorName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.commentName}>
                {c.authorName} · <Text style={styles.commentTime}>{timeAgo(c.createdAt)}</Text>
              </Text>
              <Text style={styles.commentBody}>{c.body}</Text>
            </View>
          </View>
        ))
      )}
      <View style={styles.commentCompose}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Add a comment…"
          placeholderTextColor={colors.textMuted}
          style={styles.commentInput}
          maxLength={1000}
        />
        <Pressable onPress={send} disabled={busy || !draft.trim()} hitSlop={6}>
          <Ionicons
            name="send"
            size={19}
            color={draft.trim() ? colors.brand : colors.textMuted}
          />
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
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

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
  body: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textPrimary, lineHeight: 20 },

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
