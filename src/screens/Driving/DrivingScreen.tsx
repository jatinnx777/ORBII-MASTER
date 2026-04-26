import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Button, ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { trackEvent } from '@/services/analytics';
import { getItem, setItem, storageKeys } from '@/services/storage';

// "Driving" tab. Doubles as a teaser for the paid Driving add-on (₹199 /
// 56 days). The stats grid is intentionally zeroed out — we do not have a
// telematics SDK plumbed in yet, so showing fabricated numbers would lie to
// the user. Once the add-on is purchased and the SDK is wired, the same
// layout fills with real data.
const PERIODS = ['This week', 'Last week', 'Custom'] as const;
type Period = typeof PERIODS[number];

type WaitlistEntry = {
  email: string;
  plan: string;
  createdAt: number;
};

async function joinDrivingWaitlist(email: string): Promise<void> {
  const existing = (await getItem<WaitlistEntry[]>(storageKeys.premiumWaitlist)) ?? [];
  const filtered = existing.filter(
    (e) => !(e.email === email && e.plan === 'driving'),
  );
  filtered.unshift({ email, plan: 'driving', createdAt: Date.now() });
  await setItem(storageKeys.premiumWaitlist, filtered);
}

export function DrivingScreen() {
  const profile = useAppSelector((s) => s.user.profile);
  const [period, setPeriod] = useState<Period>('This week');
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'You';
  const initial = (profile?.name ?? 'U').charAt(0).toUpperCase();

  const handleBuy = () => {
    trackEvent('premium_viewed');
    setWaitlistOpen(true);
  };

  const submitWaitlist = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      Alert.alert('Invalid email', 'Enter a valid email so we can reach you.');
      return;
    }
    setSubmitting(true);
    try {
      await joinDrivingWaitlist(trimmed);
      trackEvent('premium_purchased', { plan: 'driving', waitlist: true });
      setWaitlistOpen(false);
      Alert.alert(
        "You're on the list",
        "We'll email the moment Driving + Crash Detection is live. Thanks for backing ORBII early.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.header}>
        <Text style={styles.title}>Driving</Text>
        <Text style={styles.subtitle}>
          Trip stats and crash detection for {firstName}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
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
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </View>

        <LinearGradient
          colors={['#FFF6E5', '#FFE9C2']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.unlockCard}
        >
          <View style={styles.unlockIconWrap}>
            <Ionicons name="car-sport" size={28} color={colors.primary} />
          </View>
          <Text style={styles.unlockTitle}>Unlock Driver Reports</Text>
          <Text style={styles.unlockBody}>
            See how you and your family drive. Get crash detection that auto-fires
            an SOS if your phone senses an accident, even when you can't reach it.
          </Text>

          <View style={styles.benefitsList}>
            <BenefitRow icon="shield-checkmark" text="Auto-SOS on detected crash" />
            <BenefitRow icon="analytics" text="Weekly speeding and braking reports" />
            <BenefitRow icon="people" text="See driving for everyone in your circle" />
            <BenefitRow icon="time" text="Trip history with start and end times" />
          </View>
        </LinearGradient>
      </ScrollView>

      <View style={styles.buyBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.buyBarLabel}>Driving + Crash Detection</Text>
          <Text style={styles.buyBarPrice}>
            ₹199 <Text style={styles.buyBarPriceMeta}>for 56 days</Text>
          </Text>
        </View>
        <Pressable onPress={handleBuy} style={styles.buyBarBtn} accessibilityRole="button">
          <Text style={styles.buyBarBtnText}>Buy add-on</Text>
        </Pressable>
      </View>

      <WaitlistModal
        visible={waitlistOpen}
        email={email}
        onChangeEmail={setEmail}
        submitting={submitting}
        onClose={() => setWaitlistOpen(false)}
        onSubmit={submitWaitlist}
      />
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
      style={[
        styles.eventChip,
        { opacity: enter, transform: [{ scale }] },
      ]}
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

function WaitlistModal({
  visible,
  email,
  onChangeEmail,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  email: string;
  onChangeEmail: (s: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={modalStyles.backdrop}>
        <View style={modalStyles.sheet}>
          <View style={modalStyles.headerRow}>
            <Text style={modalStyles.title}>Driving add-on waitlist</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <Text style={modalStyles.body}>
            Payments aren't live yet. Drop your email and we'll be in touch the
            moment Driving + Crash Detection (₹199 / 56 days) is available.
          </Text>
          <TextInput
            value={email}
            onChangeText={onChangeEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={modalStyles.input}
          />
          <Button
            label={submitting ? 'Saving…' : 'Join waitlist'}
            onPress={onSubmit}
            loading={submitting}
            disabled={submitting}
          />
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.inputBackground,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});

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
    paddingBottom: 110,
    gap: spacing.md,
  },
  periodRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
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
  unlockCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  unlockIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  unlockTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  unlockBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
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
  buyBar: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.dark,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    ...shadows.hero,
  },
  buyBarLabel: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    letterSpacing: 0.5,
  },
  buyBarPrice: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
    marginTop: 2,
  },
  buyBarPriceMeta: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
  },
  buyBarBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  buyBarBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textInverse,
    fontSize: 14,
    letterSpacing: 0.4,
  },
});
