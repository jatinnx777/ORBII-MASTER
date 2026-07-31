import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { EmptyState, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  clearNotifications,
  listNotifications,
  markAllRead,
  type NotificationEntry,
} from '@/services/notification-inbox';
import {
  loadCommunityNotifications,
  markCommunityNotificationsRead,
  describeCommunityNotification,
  type CommunityNotification,
} from '@/services/community-notifications';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { acceptInvite, declineInvite, type CircleInvite } from '@/services/circles';
import { inviteResolved } from '@/redux/slices/circlesSlice';
import { refreshCircles, setActiveCircle } from '@/services/circles-bootstrap';

// One row model the list renders, whether the source is the local device inbox
// (SOS / helper / system) or a server-side Community activity notification.
type DisplayItem = {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  icon: { name: keyof typeof Ionicons.glyphMap; color: string; bg: string };
  onPress?: () => void;
};

export function NotificationsScreen() {
  const dispatch = useAppDispatch();
  const navigation = useNavigation();
  const invites = useAppSelector((s) => s.circles.incomingInvites);
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [local, community] = await Promise.all([
      listNotifications(),
      loadCommunityNotifications(),
    ]);
    const merged: DisplayItem[] = [
      ...local.map(localToDisplay),
      ...community.map((n) => communityToDisplay(n, navigation)),
    ].sort((a, b) => b.createdAt - a.createdAt);
    setItems(merged);
    setLoading(false);
  }, [navigation]);

  useEffect(() => {
    load();
    // Opening the screen clears the unread badge on both inboxes.
    markAllRead().catch(() => undefined);
    markCommunityNotificationsRead().catch(() => undefined);
  }, [load]);

  const hasLocal = items.some((i) => !i.id.startsWith('cn_'));

  const handleClear = async () => {
    // Only the local device inbox is clearable; Community activity is server
    // history, so those rows stay.
    await clearNotifications();
    setItems((cur) => cur.filter((i) => i.id.startsWith('cn_')));
  };

  const handleAccept = async (invite: CircleInvite) => {
    try {
      await acceptInvite(invite);
      dispatch(inviteResolved(invite.id));
      await refreshCircles();
      await setActiveCircle(invite.circleId);
    } catch {
      // ignore — surfaced on the Circles screen if it persists
    }
  };

  const handleDecline = async (invite: CircleInvite) => {
    try {
      await declineInvite(invite.id);
      dispatch(inviteResolved(invite.id));
    } catch {
      // ignore
    }
  };

  const hasContent = invites.length > 0 || items.length > 0;

  const InvitesHeader =
    invites.length > 0 ? (
      <View style={styles.invitesWrap}>
        <Text style={styles.sectionLabel}>Requests</Text>
        {invites.map((invite) => (
          <View key={invite.id} style={styles.inviteCard}>
            <View style={styles.inviteIcon}>
              <Ionicons name="people" size={18} color={colors.lavenderDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Circle invitation</Text>
              <Text style={styles.rowBody}>Someone invited you to their safety circle.</Text>
            </View>
            <Pressable onPress={() => handleDecline(invite)} style={styles.declineBtn} hitSlop={6}>
              <Text style={styles.declineText}>Decline</Text>
            </Pressable>
            <Pressable onPress={() => handleAccept(invite)} style={styles.acceptBtn} hitSlop={6}>
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
          </View>
        ))}
        {items.length > 0 ? (
          <Text style={[styles.sectionLabel, { marginTop: spacing.md }]}>Activity</Text>
        ) : null}
      </View>
    ) : null;

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Notifications</Text>
        {hasLocal ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Text style={styles.clear}>Clear all</Text>
          </Pressable>
        ) : null}
      </View>

      {!loading && !hasContent ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="notifications-off-outline"
            title="You're all caught up"
            body="SOS alerts, circle requests, and helper updates will show up here."
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={InvitesHeader}
          renderItem={({ item }) => <Row item={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </ScreenContainer>
  );
}

function Row({ item }: { item: DisplayItem }) {
  const inner = (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: item.icon.bg }]}>
        <Ionicons name={item.icon.name} size={18} color={item.icon.color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.rowTitle}>{item.title}</Text>
        <Text style={styles.rowBody} numberOfLines={2}>{item.body}</Text>
        <Text style={styles.rowMeta}>{relativeTime(item.createdAt)}</Text>
      </View>
      {item.onPress ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textMuted} style={{ alignSelf: 'center' }} />
      ) : null}
    </View>
  );
  if (!item.onPress) return inner;
  return (
    <Pressable onPress={item.onPress} style={({ pressed }) => (pressed ? { opacity: 0.6 } : null)}>
      {inner}
    </Pressable>
  );
}

function iconForKind(kind: NotificationEntry['kind']): DisplayItem['icon'] {
  switch (kind) {
    case 'sos':
      return { name: 'alert-circle', color: colors.coral, bg: colors.coralSoft };
    case 'helper':
      return { name: 'people-circle', color: colors.lavenderDeep, bg: colors.lavenderSoft };
    default:
      return { name: 'notifications', color: colors.textSecondary, bg: colors.cream };
  }
}

function communityIcon(type: CommunityNotification['type']): DisplayItem['icon'] {
  switch (type) {
    case 'like':
      return { name: 'heart', color: colors.coral, bg: colors.coralSoft };
    case 'reply':
      return { name: 'arrow-undo', color: colors.lavenderDeep, bg: colors.lavenderSoft };
    default:
      return { name: 'chatbubble-ellipses', color: colors.lavenderDeep, bg: colors.lavenderSoft };
  }
}

function localToDisplay(e: NotificationEntry): DisplayItem {
  return { id: e.id, title: e.title, body: e.body, createdAt: e.createdAt, icon: iconForKind(e.kind) };
}

function communityToDisplay(
  n: CommunityNotification,
  navigation: ReturnType<typeof useNavigation>,
): DisplayItem {
  const { title, body } = describeCommunityNotification(n);
  return {
    id: `cn_${n.id}`,
    title,
    body,
    createdAt: n.createdAt,
    icon: communityIcon(n.type),
    onPress: () => (navigation as unknown as { navigate: (r: string) => void }).navigate('CommunityFeed'),
  };
}

function relativeTime(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
  },
  clear: { ...typography.bodyMedium, color: colors.coral },
  emptyWrap: { flex: 1, paddingHorizontal: spacing.lg, justifyContent: 'center' },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  invitesWrap: { paddingTop: spacing.xs },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.card,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.lavenderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
  },
  declineText: { ...typography.label, color: colors.textSecondary },
  acceptBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.peach,
  },
  acceptText: { ...typography.label, color: colors.textPrimary },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.md },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 2 },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowBody: { ...typography.caption, color: colors.textSecondary },
  rowMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  separator: { height: 1, backgroundColor: colors.divider },
});
