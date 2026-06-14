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
import { EmptyState, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  clearNotifications,
  listNotifications,
  markAllRead,
  type NotificationEntry,
} from '@/services/notification-inbox';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { acceptInvite, declineInvite, type CircleInvite } from '@/services/circles';
import { inviteResolved } from '@/redux/slices/circlesSlice';
import { refreshCircles, setActiveCircle } from '@/services/circles-bootstrap';

export function NotificationsScreen() {
  const dispatch = useAppDispatch();
  const invites = useAppSelector((s) => s.circles.incomingInvites);
  const [items, setItems] = useState<NotificationEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const list = await listNotifications();
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    markAllRead().catch(() => undefined);
  }, [load]);

  const handleClear = async () => {
    await clearNotifications();
    setItems([]);
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
        {items.length > 0 ? (
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
          renderItem={({ item }) => <Row entry={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </ScreenContainer>
  );
}

function Row({ entry }: { entry: NotificationEntry }) {
  const icon = iconForKind(entry.kind);
  return (
    <View style={styles.row}>
      <View style={[styles.iconWrap, { backgroundColor: icon.bg }]}>
        <Ionicons name={icon.name} size={18} color={icon.color} />
      </View>
      <View style={styles.body}>
        <Text style={styles.rowTitle}>{entry.title}</Text>
        <Text style={styles.rowBody}>{entry.body}</Text>
        <Text style={styles.rowMeta}>{relativeTime(entry.createdAt)}</Text>
      </View>
    </View>
  );
}

function iconForKind(kind: NotificationEntry['kind']): {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
} {
  switch (kind) {
    case 'sos':
      return { name: 'alert-circle', color: colors.coral, bg: colors.coralSoft };
    case 'helper':
      return { name: 'people-circle', color: colors.lavenderDeep, bg: colors.lavenderSoft };
    default:
      return { name: 'notifications', color: colors.textSecondary, bg: colors.cream };
  }
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
