import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { formatDuration, formatStamp, type Visit } from '@/services/geofence';
import type { AppScreenProps } from '@/navigation/types';

/**
 * One visit, in full.
 *
 * The feed row can only carry a sentence. This screen answers the questions the
 * row raises: who, which place, from when to when, how long, and whether the
 * exit was expected.
 *
 * ON TONE. This is somebody's daughter's movements, and a screen that presents
 * them as a surveillance readout is a screen that makes the app feel like
 * something to hide from. The framing is a visit that happened, not a subject
 * being tracked, and the page says plainly that this history is deleted nightly
 * so nobody has to wonder how long it is kept.
 */
export function ActivityDetailScreen({ route, navigation }: AppScreenProps<'ActivityDetail'>) {
  const visit = route.params.visit as Visit;

  const ongoing = visit.leftAt == null;
  const who = visit.memberName ?? 'A circle member';

  const status = useMemo(() => {
    if (ongoing) return { label: 'Still there', tone: colors.sageDeep, bg: colors.sageSoft, icon: 'location' as const };
    if (visit.authorized === false)
      return { label: 'Flagged', tone: colors.coralDeep, bg: colors.coralSoft, icon: 'alert-circle' as const };
    if (visit.authorized === true)
      return { label: 'Expected', tone: colors.sageDeep, bg: colors.sageSoft, icon: 'checkmark-circle' as const };
    return { label: 'Recorded', tone: colors.textSecondary, bg: colors.creamDeep, icon: 'time' as const };
  }, [ongoing, visit.authorized]);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={23} color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Visit details</Text>
        <View style={{ width: 23 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
          <Ionicons name={status.icon} size={14} color={status.tone} />
          <Text style={[styles.statusText, { color: status.tone }]}>{status.label}</Text>
        </View>

        <Text style={styles.who}>{who}</Text>
        <Text style={styles.where}>
          {ongoing ? 'is at ' : 'was at '}
          <Text style={styles.place}>{visit.zoneLabel}</Text>
        </Text>

        {/* The headline number. Duration is what somebody actually wants, and
            for an ongoing visit it counts from arrival to now. */}
        <View style={styles.durationCard}>
          <Text style={styles.durationLabel}>
            {ongoing ? 'There for' : 'Stayed for'}
          </Text>
          <Text style={styles.duration}>{formatDuration(visit.durationS)}</Text>
        </View>

        <View style={styles.card}>
          <Row
            icon="enter-outline"
            label="Arrived"
            value={formatStamp(visit.enteredAt)}
            hint={visit.enteredAt ? null : 'No arrival was recorded for this visit'}
          />
          <View style={styles.divider} />
          <Row
            icon="exit-outline"
            label="Left"
            value={ongoing ? 'Still there' : formatStamp(visit.leftAt)}
            hint={ongoing ? 'This visit is still in progress' : null}
          />
          <View style={styles.divider} />
          <Row icon="location-outline" label="Place" value={visit.zoneLabel} />
          <View style={styles.divider} />
          <Row icon="person-outline" label="Who" value={who}
               hint={visit.memberName ? null : 'This person is no longer in your circle'} />
        </View>

        {visit.authorized === false ? (
          <View style={styles.flagged}>
            <Ionicons name="alert-circle" size={16} color={colors.coralDeep} />
            <Text style={styles.flaggedText}>
              This exit was flagged because it happened outside the hours you set for this
              zone. Flagged does not mean something went wrong; it means it was worth telling
              you about.
            </Text>
          </View>
        ) : null}

        {/* Said here rather than buried in settings. Somebody looking at another
            person's movements should be reminded, on this screen, that the app
            is not building a permanent record. */}
        <View style={styles.privacy}>
          <Ionicons name="shield-checkmark" size={14} color={colors.sageDeep} />
          <Text style={styles.privacyText}>
            Location history older than 7 days is deleted. Only your circle can see
            this, and we never sell it.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
  hint?: string | null;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={17} color={colors.brandDeep} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 17, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: radius.pill ?? 999,
    marginBottom: spacing.md,
  },
  statusText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12 },

  who: { fontFamily: fontFamilies.poppinsBold, fontSize: 26, color: colors.textPrimary, letterSpacing: -0.4 },
  where: { fontFamily: fontFamilies.interRegular, fontSize: 16, color: colors.textSecondary, marginTop: 2 },
  place: { fontFamily: fontFamilies.interMedium, color: colors.textPrimary },

  durationCard: {
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  durationLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: colors.brandDeep,
  },
  duration: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    color: colors.textPrimary,
    letterSpacing: -0.8,
    marginTop: 2,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: spacing.xs,
    ...shadows.card,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  rowValue: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textPrimary, marginTop: 1 },
  rowHint: { fontFamily: fontFamilies.interRegular, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginLeft: spacing.md + 34 + spacing.sm },

  flagged: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'flex-start',
    backgroundColor: colors.coralSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  flaggedText: { flex: 1, fontFamily: fontFamilies.interRegular, fontSize: 13, lineHeight: 19, color: colors.textPrimary },

  privacy: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
    marginTop: spacing.lg,
    paddingHorizontal: 2,
  },
  privacyText: { flex: 1, fontFamily: fontFamilies.interRegular, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
});
