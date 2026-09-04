import React, { useCallback, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBrandSheet, SkeletonList } from '@/components/common';
import { ProfileHeader } from '@/components/community/ProfileHeader';
import { Tabs } from '@/components/community/Tabs';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  blockProfile,
  follow,
  getUserProfile,
  loadUserPosts,
  unfollow,
  votePost,
  type FeedPost,
  type PostSort,
  type PublicProfile,
} from '@/services/community-feed';

const CATEGORY_COLOR: Record<string, string> = {
  general: colors.textMuted, safety: colors.sageDeep, legal: colors.brandDeep, emergency: colors.coralDeep,
};
const SORTS: { key: PostSort; label: string }[] = [
  { key: 'newest', label: 'Latest' },
  { key: 'popular', label: 'Top' },
  { key: 'oldest', label: 'Earliest' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function CommunityUserProfileScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const sheet = useBrandSheet();
  const { profileId } = (route.params ?? {}) as { profileId: string };

  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [sort, setSort] = useState<PostSort>('newest');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, list] = await Promise.all([getUserProfile(profileId), loadUserPosts(profileId, sort)]);
    setProfile(p);
    setPosts(list);
    setLoading(false);
  }, [profileId, sort]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const changeSort = async (s: PostSort) => {
    setSort(s);
    setPosts(await loadUserPosts(profileId, s));
  };

  const toggleFollow = async () => {
    if (!profile) return;
    const next = !profile.isFollowing;
    setProfile({ ...profile, isFollowing: next, followers: profile.followers + (next ? 1 : -1) });
    if (next) await follow(profile.id);
    else await unfollow(profile.id);
  };

  const doBlock = () => {
    if (!profile) return;
    sheet.confirm({
      title: `Block ${profile.displayName}?`,
      body: 'You will no longer see their posts, and they will not see yours.',
      destructive: true,
      confirmLabel: 'Block',
      icon: 'ban',
      onConfirm: async () => {
        await blockProfile(profile.id);
        navigation.goBack();
      },
    });
  };

  const vote = async (post: FeedPost) => {
    const cleared = post.myVote === 1;
    setPosts((cur) => cur.map((p) => {
      if (p.id !== post.id) return p;
      return { ...p, ups: p.ups + (cleared ? -1 : 1), myVote: (cleared ? 0 : 1) as -1 | 0 | 1 };
    }));
    await votePost(post, 1);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.topbar}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.topTitle}>Profile</Text>
          {profile && !profile.isBlocked ? (
            <Pressable onPress={doBlock} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
            </Pressable>
          ) : <View style={{ width: 40 }} />}
        </View>

        {loading ? (
          <SkeletonList rows={3} />
        ) : !profile ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Profile not found.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <ProfileHeader profile={profile} onToggleFollow={() => void toggleFollow()} />

            <Tabs
              tabs={SORTS.map((x) => ({ key: x.key, label: x.label }))}
              active={sort}
              onChange={(k) => void changeSort(k as PostSort)}
            />

            {/* Posts */}
            {posts.length === 0 ? (
              <View style={styles.empty}><Text style={styles.emptyText}>No posts yet.</Text></View>
            ) : (
              posts.map((p) => (
                <View key={p.id} style={styles.card}>
                  <View style={styles.cardTop}>
                    <View style={styles.catPill}>
                      <Text style={[styles.catText, { color: CATEGORY_COLOR[p.category] ?? colors.textMuted }]}>
                        {p.category.charAt(0).toUpperCase() + p.category.slice(1)}
                      </Text>
                    </View>
                    <Text style={styles.date}>{fmtDate(p.createdAt)}</Text>
                  </View>
                  {p.title ? <Text style={styles.postTitle}>{p.title}</Text> : null}
                  {p.body ? <Text style={styles.body}>{p.body}</Text> : null}
                  <View style={styles.actions}>
                    <Pressable onPress={() => vote(p)} hitSlop={6} style={styles.actBtn}>
                      <Ionicons name={p.myVote === 1 ? 'heart' : 'heart-outline'} size={18} color={p.myVote === 1 ? colors.coralDeep : colors.textSecondary} />
                      <Text style={[styles.actCount, p.myVote === 1 && { color: colors.coralDeep }]}>{p.ups}</Text>
                    </Pressable>
                    <View style={styles.actBtn}>
                      <Ionicons name="chatbubble-outline" size={16} color={colors.textSecondary} />
                      <Text style={styles.actCount}>{p.commentCount}</Text>
                    </View>
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topTitle: { ...typography.h2, fontSize: 17, color: colors.textPrimary },
  scroll: { padding: spacing.lg, paddingBottom: 120, gap: spacing.md },





  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, ...shadows.card },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catPill: { backgroundColor: colors.creamDeep, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  catText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 10.5 },
  date: { ...typography.caption, fontSize: 11.5, color: colors.textMuted },
  postTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary, lineHeight: 21 },
  body: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.textSecondary, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  actBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  actCount: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },

  empty: { alignItems: 'center', paddingVertical: spacing.xxl },
  emptyText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textSecondary },
});
