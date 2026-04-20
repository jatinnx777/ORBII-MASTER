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
import {
  EmptyState,
  ScreenContainer,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import {
  clearNotifications,
  listNotifications,
  markAllRead,
  type NotificationEntry,
} from '@/services/notification-inbox';

export function NotificationsScreen() {
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

      {!loading && items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <EmptyState
            icon="notifications-off-outline"
            title="No notifications yet"
            body="SOS alerts, helper updates, and system messages will appear here."
          />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={load} />
          }
          contentContainerStyle={styles.listContent}
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
      return { name: 'alert-circle', color: colors.primary, bg: '#FFEAEA' };
    case 'helper':
      return {
        name: 'people-circle',
        color: colors.success,
        bg: '#E5F7EB',
      };
    default:
      return {
        name: 'notifications',
        color: colors.textSecondary,
        bg: colors.surface,
      };
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
    fontSize: 22,
    color: colors.textPrimary,
  },
  clear: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
  emptyWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  rowBody: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
});
