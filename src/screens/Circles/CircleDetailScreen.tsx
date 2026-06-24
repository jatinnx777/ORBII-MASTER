import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EmptyState } from '@/components/common';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { refreshCircleMembers } from '@/services/circles-bootstrap';
import {
  deleteCircle,
  leaveCircle,
  type CircleMember,
} from '@/services/circles';
import { circleRemoved } from '@/redux/slices/circlesSlice';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// Circle detail. Shows the member list (real, from circle_members joined
// with users_public), an Invite button, and Leave / Delete depending on
// role. No hardcoded names — empty member list shows an EmptyState.

export function CircleDetailScreen({
  route,
  navigation,
}: AppScreenProps<'CircleDetail'>) {
  const { circleId } = route.params;
  const dispatch = useAppDispatch();
  const circle = useAppSelector((s) =>
    s.circles.circles.find((c) => c.id === circleId),
  );
  const members = useAppSelector(
    (s) => s.circles.membersByCircle[circleId] ?? [],
  );
  const myUid = useAppSelector((s) => s.user.profile?.uid ?? null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshCircleMembers(circleId);
  }, [circleId]);

  const myRole = useMemo(() => {
    return members.find((m) => m.userId === myUid)?.role ?? null;
  }, [members, myUid]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshCircleMembers(circleId);
    } finally {
      setRefreshing(false);
    }
  }, [circleId]);

  const confirmLeave = () => {
    appAlert(
      'Leave circle?',
      'You will stop receiving safety alerts from this group.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await leaveCircle(circleId);
              dispatch(circleRemoved(circleId));
              navigation.goBack();
            } catch (err) {
              appAlert(
                'Could not leave',
                err instanceof Error ? err.message : 'Try again.',
              );
            }
          },
        },
      ],
    );
  };

  const confirmDelete = () => {
    appAlert(
      'Delete circle?',
      `Everyone will be removed from "${circle?.name ?? 'this circle'}". This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCircle(circleId);
              dispatch(circleRemoved(circleId));
              navigation.goBack();
            } catch (err) {
              appAlert(
                'Could not delete',
                err instanceof Error ? err.message : 'Try again.',
              );
            }
          },
        },
      ],
    );
  };

  if (!circle) {
    return (
      <View style={[styles.root, styles.center]}>
        <EmptyState
          icon="alert-circle-outline"
          title="Circle not found"
          body="It may have been deleted, or you may have left it."
        />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.iconBtn}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1 }} />
          <Pressable
            onPress={() =>
              navigation.navigate('CircleInvite', { circleId })
            }
            style={styles.iconBtn}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Invite to circle"
          >
            <Ionicons name="person-add-outline" size={20} color={colors.brandDeep} />
          </Pressable>
        </View>

        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <MemberRow member={item} isMe={item.userId === myUid} />}
          contentContainerStyle={{
            paddingHorizontal: spacing.md,
            paddingBottom: 120,
            gap: spacing.sm,
          }}
          ListHeaderComponent={
            <View style={styles.heroWrap}>
              <View
                style={[
                  styles.heroIcon,
                  { backgroundColor: tint(circle.color, 0.16) },
                ]}
              >
                {circle.emoji ? (
                  <Text style={styles.heroEmoji}>{circle.emoji}</Text>
                ) : (
                  <Ionicons name="people-circle" size={32} color={circle.color} />
                )}
              </View>
              <Text style={styles.heroName}>{circle.name}</Text>
              <Text style={styles.heroMeta}>
                {members.length === 1
                  ? '1 member'
                  : `${members.length} members`}
                {circle.isDefault ? ' · Default circle' : ''}
              </Text>
              <View style={styles.heroActions}>
                <Pressable
                  onPress={() =>
                    navigation.navigate('CircleInvite', { circleId })
                  }
                  style={({ pressed }) => [
                    styles.primaryAction,
                    pressed && styles.pressedScale,
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons name="add" size={16} color={colors.textInverse} />
                  <Text style={styles.primaryActionText}>Invite</Text>
                </Pressable>
                {myRole === 'owner' ? (
                  <Pressable
                    onPress={confirmDelete}
                    style={({ pressed }) => [
                      styles.dangerAction,
                      pressed && styles.pressedScale,
                    ]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={styles.dangerActionText}>Delete</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={confirmLeave}
                    style={({ pressed }) => [
                      styles.dangerAction,
                      pressed && styles.pressedScale,
                    ]}
                    accessibilityRole="button"
                  >
                    <Ionicons name="exit-outline" size={16} color={colors.error} />
                    <Text style={styles.dangerActionText}>Leave</Text>
                  </Pressable>
                )}
              </View>
              <Text style={styles.sectionLabel}>Members</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={{ paddingTop: spacing.xl }}>
              <ActivityIndicator color={colors.brandDeep} />
            </View>
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brandDeep}
            />
          }
        />
      </SafeAreaView>
    </View>
  );
}

function MemberRow({ member, isMe }: { member: CircleMember; isMe: boolean }) {
  const displayName =
    member.name?.trim() ||
    (member.username ? `@${member.username}` : 'Member');
  const initial =
    (member.name?.trim().charAt(0) ?? member.username?.charAt(0) ?? '?').toUpperCase();
  return (
    <View style={styles.memberRow}>
      <View style={styles.avatar}>
        {member.photoUrl ? (
          <Image source={{ uri: member.photoUrl }} style={styles.avatarImg} />
        ) : (
          <Text style={styles.avatarInitial}>{initial}</Text>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.memberName} numberOfLines={1}>
          {displayName}
          {isMe ? <Text style={styles.youTag}>  · You</Text> : null}
        </Text>
        <Text style={styles.memberMeta}>
          {member.role === 'owner' ? 'Owner' : member.role === 'admin' ? 'Admin' : 'Member'}
        </Text>
      </View>
    </View>
  );
}

function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    alignItems: 'center',
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroEmoji: { fontSize: 32 },
  heroName: {
    ...typography.h2,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  heroMeta: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  heroActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.brandDeep,
  },
  primaryActionText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textInverse,
    letterSpacing: 0.2,
  },
  dangerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.25)',
  },
  dangerActionText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.error,
    letterSpacing: 0.2,
  },
  pressedScale: {
    opacity: 0.92,
    transform: [{ scale: 0.97 }],
  },
  sectionLabel: {
    alignSelf: 'flex-start',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.05)',
    ...shadows.card,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.brandDeep,
  },
  memberName: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  memberMeta: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  youTag: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.brandDeep,
  },
});
