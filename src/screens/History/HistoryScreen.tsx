import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  Card,
  EmptyState,
  ScreenContainer,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import type { SOSRecord } from '@/types';
import type { AppStackParamList, TabParamList } from '@/navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'History'>,
  NativeStackNavigationProp<AppStackParamList>
>;

export function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const records = useAppSelector((s) => s.history.records);

  if (records.length === 0) {
    return (
      <ScreenContainer padded={false}>
        <View style={styles.header}>
          <Text style={styles.title}>SOS history</Text>
        </View>
        <EmptyState
          icon="time-outline"
          title="No SOS alerts yet"
          body="When you send or resolve an alert, it'll show up here with the helpers who responded."
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>SOS history</Text>
        <Text style={styles.subtitle}>
          {records.length} incident{records.length === 1 ? '' : 's'}
        </Text>
      </View>

      <FlatList
        data={records}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() =>
              navigation.navigate('IncidentDetail', { recordId: item.id })
            }
          >
            <Card style={styles.item}>
              <StatusIcon record={item} />
              <View style={styles.info}>
                <Text style={styles.when}>{formatDateTime(item.timestamp)}</Text>
                <Text style={styles.where} numberOfLines={1}>
                  {item.location.address ?? formatLatLng(item)}
                </Text>
                <View style={styles.metaRow}>
                  <StatusPill status={item.status} />
                  <Text style={styles.meta}>
                    {item.helpers.length} helper
                    {item.helpers.length === 1 ? '' : 's'}
                  </Text>
                  {item.responseTime != null ? (
                    <>
                      <Text style={styles.dot}>•</Text>
                      <Text style={styles.meta}>
                        {formatResponseTime(item.responseTime)}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Card>
          </Pressable>
        )}
      />
    </ScreenContainer>
  );
}

function StatusIcon({ record }: { record: SOSRecord }) {
  const map = {
    active: { icon: 'alert-circle' as const, color: colors.primary },
    resolved: { icon: 'checkmark-circle' as const, color: colors.success },
    cancelled: { icon: 'close-circle' as const, color: colors.textMuted },
  };
  const m = map[record.status];
  return (
    <View style={styles.iconWrap}>
      <Ionicons name={m.icon} size={28} color={m.color} />
    </View>
  );
}

function StatusPill({ status }: { status: SOSRecord['status'] }) {
  const map = {
    active: { label: 'Active', bg: colors.primary, fg: colors.textInverse },
    resolved: { label: 'Resolved', bg: colors.success, fg: colors.textInverse },
    cancelled: { label: 'Cancelled', bg: colors.surface, fg: colors.textSecondary },
  };
  const m = map[status];
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <Text style={[styles.pillText, { color: m.fg }]}>{m.label}</Text>
    </View>
  );
}

function formatDateTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatLatLng(r: SOSRecord) {
  return `${r.location.latitude.toFixed(4)}, ${r.location.longitude.toFixed(4)}`;
}

function formatResponseTime(seconds: number) {
  if (seconds < 60) return `${seconds}s response`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s response`;
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.lg,
    gap: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  iconWrap: {
    width: 40,
    alignItems: 'center',
  },
  info: { flex: 1, gap: 2 },
  when: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  where: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  dot: {
    ...typography.caption,
    color: colors.textMuted,
  },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  pillText: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
