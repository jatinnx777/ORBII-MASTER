import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { crashDetectionToggled } from '@/redux/slices/appSlice';

// "Driving" tab. Real, working features only. The stats grid stays empty
// because we don't have a telematics SDK yet — we won't fake numbers.
// Crash detection is the live feature: a sensor toggle that actually fires
// SOS when the accelerometer detects an impact.
const PERIODS = ['This week', 'Last week', 'Custom'] as const;
type Period = typeof PERIODS[number];

export function DrivingScreen() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const crashDetection = useAppSelector((s) => s.app.crashDetection);
  const [period, setPeriod] = useState<Period>('This week');

  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'You';
  const initial = (profile?.name ?? 'U').charAt(0).toUpperCase();

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Driving</Text>
        <Text style={styles.subtitle}>
          Crash detection and trip stats for {firstName}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={crashDetection ? ['#D7F8E5', '#B6F2D6'] : ['#FFF6E5', '#FFE9C2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.crashCard}
        >
          <View style={styles.crashHeader}>
            <View style={styles.crashIconWrap}>
              <Ionicons
                name={crashDetection ? 'shield-checkmark' : 'car-sport'}
                size={28}
                color={colors.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.crashTitle}>Crash detection</Text>
              <Text style={styles.crashStatus}>
                {crashDetection
                  ? 'Active. Phone is watching for impacts.'
                  : 'Off. Toggle on before driving.'}
              </Text>
            </View>
            <Switch
              value={crashDetection}
              onValueChange={(v) => {
                dispatch(crashDetectionToggled(v));
              }}
              trackColor={{ true: colors.primary, false: colors.border }}
            />
          </View>
          <Text style={styles.crashBody}>
            ORBII reads your phone's accelerometer at 50 Hz. A sustained 3.5 g
            jolt triggers the SOS countdown. You get 5 seconds to cancel before
            nearby helpers, your contacts, and the police are alerted.
          </Text>
          <View style={styles.benefitsList}>
            <BenefitRow icon="pulse" text="50 Hz accelerometer with 80 ms sustain check" />
            <BenefitRow icon="hand-left" text="5-second cancel window before SOS fires" />
            <BenefitRow icon="people" text="Same nearby helpers are dispatched" />
            <BenefitRow icon="battery-half" text="Sensor stays on whenever the toggle is on" />
          </View>
        </LinearGradient>

        <View style={styles.sectionLabel}>
          <Text style={styles.sectionLabelText}>Trip stats</Text>
        </View>

        <View style={styles.periodRow}>
          {PERIODS.map((p) => (
            <Pressable
              key={p}
              onPress={() => setPeriod(p)}
              style={[styles.periodPill, p === period && styles.periodPillActive]}
            >
              <Text
                style={[
                  styles.periodPillText,
                  p === period && styles.periodPillTextActive,
                ]}
              >
                {p}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.eventGrid}>
          <EventChip index={0} icon="speedometer" color="#FF6B6B" label="Speeding" value={0} />
          <EventChip index={1} icon="warning" color="#4DA3FF" label="Hard brake" value={0} />
          <EventChip index={2} icon="flash" color="#FFA500" label="Fast accel" value={0} />
          <EventChip index={3} icon="phone-portrait" color="#A855F7" label="Phone use" value={0} />
        </View>

        <View style={styles.bigStatsRow}>
          <View style={styles.bigStatCard}>
            <Text style={styles.bigStatLabel}>Top Speed</Text>
            <Text style={styles.bigStatValue}>—</Text>
            <Text style={styles.bigStatUnit}>km/h</Text>
          </View>
          <View style={styles.bigStatCard}>
            <View style={styles.bigStatLine}>
              <Text style={styles.bigStatLabel}>Drives</Text>
              <Text style={styles.bigStatLineValue}>0</Text>
            </View>
            <View style={[styles.bigStatLine, { marginTop: spacing.sm }]}>
              <Text style={styles.bigStatLabel}>Total km</Text>
              <Text style={styles.bigStatLineValue}>0</Text>
            </View>
          </View>
        </View>

        <View style={styles.driverCard}>
          <View style={styles.driverAvatar}>
            <View style={styles.driverAvatarInner}>
              <Text style={styles.driverAvatarText}>{initial}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.driverName}>{firstName}</Text>
            <Text style={styles.driverMeta}>No drives yet</Text>
            <View style={styles.riskyChip}>
              <Ionicons name="lock-closed" size={11} color={colors.textSecondary} />
              <Text style={styles.riskyChipText}>0 risky events</Text>
            </View>
          </View>
        </View>

        <Text style={styles.footnote}>
          Trip data fills in once the telematics module is wired. Crash
          detection above is live and works without it.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function EventChip({
  icon,
  color,
  label,
  value,
  index,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  label: string;
  value: number;
  index: number;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const id = setTimeout(() => {
      Animated.spring(enter, {
        toValue: 1,
        speed: 14,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
    }, 120 + index * 60);
    return () => clearTimeout(id);
  }, [enter, index]);

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  return (
    <Animated.View
      style={[styles.eventChip, { opacity: enter, transform: [{ scale }] }]}
    >
      <View style={[styles.eventChipIconWrap, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Text style={styles.eventChipValue}>{value}</Text>
      <Text style={styles.eventChipLabel} numberOfLines={1}>
        {label}
      </Text>
    </Animated.View>
  );
}

function BenefitRow({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
}) {
  return (
    <View style={styles.benefitRow}>
      <Ionicons name={icon} size={14} color={colors.success} />
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 2,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  crashCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  crashHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  crashIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,0,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crashTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  crashStatus: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  crashBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  benefitsList: {
    gap: 6,
    marginTop: spacing.sm,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  benefitText: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 13,
  },
  sectionLabel: {
    paddingHorizontal: spacing.xs,
    marginTop: spacing.sm,
  },
  sectionLabelText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  periodPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  periodPillActive: {
    backgroundColor: colors.dark,
  },
  periodPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  periodPillTextActive: {
    color: colors.textInverse,
  },
  eventGrid: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  eventChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  eventChipIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventChipValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  eventChipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    flex: 1,
  },
  bigStatsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bigStatCard: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    minHeight: 96,
    justifyContent: 'center',
    ...shadows.card,
  },
  bigStatLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
  },
  bigStatValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    marginTop: 4,
  },
  bigStatUnit: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
  },
  bigStatLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bigStatLineValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  driverCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  driverAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E0D6F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarInner: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#7C5CD9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  driverAvatarText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
  },
  driverName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  driverMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  riskyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.circle,
    marginTop: 6,
  },
  riskyChipText: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
});
