import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { appAlert, useBrandSheet } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  avatarEmoji,
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
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'popular', label: 'Most Popular' },
];
const GENDER_LABEL: Record<string, string> = {
  female: 'Female', male: 'Male', nonbinary: 'Non-binary', undisclosed: '',
};

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
          <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
        ) : !profile ? (
          <View style={styles.empty}><Text style={styles.emptyText}>Profile not found.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            {/* Header */}
            <View style={styles.pHead}>
              <View style={styles.avatar}><Text style={styles.avatarEmoji}>{avatarEmoji(profile.avatarKey)}</Text></View>
              <Text style={styles.name}>{profile.displayName}</Text>
              <Text style={styles.handle}>@{profile.handle}</Text>
              {GENDER_LABEL[profile.gender] ? <Text style={styles.gender}>{GENDER_LABEL[profile.gender]}</Text> : null}
              {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}

              <View style={styles.stats}>
                <View style={styles.stat}><Text style={styles.statNum}>{profile.followers}</Text><Text style={styles.statLbl}>Followers</Text></View>
                <View style={styles.statSep} />
                <View style={styles.stat}><Text style={styles.statNum}>{profile.following}</Text><Text style={styles.statLbl}>Following</Text></View>
                {profile.helped > 0 ? (
                  <>
                    <View style={styles.statSep} />
                    <View style={styles.stat}>
                      <Text style={[styles.statNum, { color: colors.sageDeep }]}>{profile.helped}</Text>
                      <Text style={styles.statLbl}>Helped</Text>
                    </View>
                  </>
                ) : null}
              </View>

              <Pressable onPress={toggleFollow} style={[styles.followBtn, profile.isFollowing && styles.followingBtn]}>
                <Text style={[styles.followText, profile.isFollowing && styles.followingText]}>
                  {profile.isFollowing ? 'Following' : 'Follow'}
                </Text>
              </Pressable>
            </View>

            {/* Sort */}
            <View style={styles.sortRow}>
              {SORTS.map((s) => (
                <Pressable key={s.key} onPress={() => changeSort(s.key)} style={[styles.sortChip, sort === s.key && styles.sortChipOn]}>
                  <Text style={[styles.sortText, sort === s.key && styles.sortTextOn]}>{s.label}</Text>
                </Pressable>
              ))}
            </View>

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

  pHead: { alignItems: 'center', gap: 4, paddingBottom: spacing.md },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  avatarEmoji: { fontSize: 42 },
  name: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary },
  handle: { fontFamily: fontFamilies.interRegular, fontSize: 13.5, color: colors.textMuted },
  gender: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.brandDeep, marginTop: 4 },
  bio: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20, marginTop: 8, maxWidth: 300 },

  stats: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg, marginTop: spacing.md },
  stat: { alignItems: 'center' },
  statNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  statLbl: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted },
  statSep: { width: 1, height: 28, backgroundColor: colors.divider },

  followBtn: { marginTop: spacing.md, backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 40, paddingVertical: 11 },
  followingBtn: { backgroundColor: colors.brandSoft },
  followText: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textInverse },
  followingText: { color: colors.brandDeep },

  sortRow: { flexDirection: 'row', gap: spacing.sm },
  sortChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.surface, ...shadows.icon },
  sortChipOn: { backgroundColor: colors.brand },
  sortText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
  sortTextOn: { color: colors.textInverse },

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
