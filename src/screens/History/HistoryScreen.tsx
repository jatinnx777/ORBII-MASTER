import React, { useMemo } from 'react';
import {
  Pressable,
  SectionList,
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
import type { SOSKind, SOSRecord } from '@/types';
import type { AppStackParamList, TabParamList } from '@/navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'History'>,
  NativeStackNavigationProp<AppStackParamList>
>;

type Section = {
  title: string;
  data: SOSRecord[];
};

function recordKind(r: SOSRecord): SOSKind {
  return r.kind ?? 'real';
}

export function HistoryScreen() {
  const navigation = useNavigation<Nav>();
  const records = useAppSelector((s) => s.history.records);

  const sections: Section[] = useMemo(() => {
    const real = records.filter((r) => recordKind(r) === 'real');
    const test = records.filter((r) => recordKind(r) === 'test');
    const out: Section[] = [];
    if (real.length > 0) out.push({ title: 'Real alerts', data: real });
    if (test.length > 0) out.push({ title: 'Practice runs', data: test });
    return out;
  }, [records]);

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

      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        SectionSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
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
                  <StatusPill record={item} />
                  <Text style={styles.meta}>{describeOutcome(item)}</Text>
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
  if (recordKind(record) === 'test') {
    return (
      <View style={styles.iconWrap}>
        <Ionicons name="flask-outline" size={28} color={colors.textMuted} />
      </View>
    );
  }
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

// One pill per record — surfaces the most informative thing about it.
//   Test record           → "PRACTICE"
//   Cancelled before send → "CANCELLED"
//   Resolved with helper  → "RESOLVED"
//   Real, 0 responders    → "NO RESPONSE"
//   Real, helpers but unresolved → "ACTIVE"
function StatusPill({ record }: { record: SOSRecord }) {
  const tone = pillTone(record);
  return (
    <View style={[styles.pill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.pillText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
  );
}

function pillTone(record: SOSRecord): {
  label: string;
  bg: string;
  fg: string;
} {
  if (recordKind(record) === 'test') {
    return { label: 'PRACTICE', bg: colors.surface, fg: colors.textSecondary };
  }
  if (record.status === 'cancelled') {
    return { label: 'CANCELLED', bg: colors.surface, fg: colors.textSecondary };
  }
  if (record.status === 'resolved') {
    return { label: 'RESOLVED', bg: colors.success, fg: colors.textInverse };
  }
  // status === 'active'
  if (record.helpers.length === 0) {
    return { label: 'NO RESPONSE', bg: colors.warning, fg: colors.dark };
  }
  return { label: 'ACTIVE', bg: colors.primary, fg: colors.textInverse };
}

// Outcome line: never shows a response time when there were no helpers,
// never shows a helper count for cancelled/test runs.
function describeOutcome(record: SOSRecord): string {
  if (recordKind(record) === 'test') return 'No real alerts sent';
  if (record.status === 'cancelled') return 'Cancelled during countdown';
  const helpers = record.helpers.length;
  if (helpers === 0) return 'No helpers responded';
  const helperText = `${helpers} helper${helpers === 1 ? '' : 's'}`;
  if (record.responseTime != null) {
    return `${helperText} · ${formatResponseTime(record.responseTime)}`;
  }
  return helperText;
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
  sectionHeader: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textSecondary,
    letterSpacing: 1,
    fontSize: 11,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
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
