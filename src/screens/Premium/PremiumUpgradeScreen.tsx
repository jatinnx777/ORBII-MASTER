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
import { Button, ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { trackEvent } from '@/services/analytics';
import { getItem, setItem, storageKeys } from '@/services/storage';

// Three subscription tiers, compared side-by-side. Every cell tells the
// user exactly what they get and what they don't — no marketing wiggle.
// Payments are not live yet; the upgrade buttons capture waitlist emails.
type PlanId = 'free' | 'premium' | 'premium_plus';

type Plan = {
  id: PlanId;
  name: string;
  shortName: string;
  priceLabel: string;
  perPeriod: string;
  highlight?: boolean;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    shortName: 'Free',
    priceLabel: '₹0',
    perPeriod: 'forever',
  },
  {
    id: 'premium',
    name: 'Premium',
    shortName: 'Premium',
    priceLabel: '₹99',
    perPeriod: 'per month',
    highlight: true,
  },
  {
    id: 'premium_plus',
    name: 'Premium Plus',
    shortName: 'Plus',
    priceLabel: '₹299',
    perPeriod: 'per month',
  },
];

// Cell value: a string renders as plain text, true = ✓, false = empty dash.
type Cell = string | boolean;

type FeatureRow = {
  label: string;
  hint?: string;
  values: Record<PlanId, Cell>;
};

type FeatureGroup = {
  title: string;
  rows: FeatureRow[];
};

const FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'SOS dispatch',
    rows: [
      {
        label: 'Monthly SOS limit',
        hint: 'How many SOS broadcasts you can fire per calendar month.',
        values: { free: '2', premium: 'Unlimited', premium_plus: 'Unlimited' },
      },
      {
        label: 'Dispatch priority',
        hint: 'Order helpers see your SOS in. Premium users surface above Free.',
        values: { free: 'Standard', premium: 'Priority', premium_plus: 'Top priority' },
      },
      {
        label: 'Target response time',
        hint: 'Median time for the first helper to arrive in covered cities.',
        values: { free: '5–7 min', premium: '2–3 min', premium_plus: '2 min' },
      },
      {
        label: 'Police auto-notify',
        hint: 'Local police control room is dialled the moment SOS fires.',
        values: { free: true, premium: true, premium_plus: true },
      },
      {
        label: 'Lock-screen SOS shortcut',
        values: { free: true, premium: true, premium_plus: true },
      },
    ],
  },
  {
    title: 'Voice and hands-free',
    rows: [
      {
        label: 'Voice detection',
        hint: 'Listens for "help", "bachao", "madad" and auto-fires SOS.',
        values: { free: false, premium: true, premium_plus: true },
      },
      {
        label: 'Background listening',
        hint: 'Voice trigger keeps working while the app is closed.',
        values: { free: false, premium: true, premium_plus: true },
      },
      {
        label: 'Crash-detected SOS',
        hint: 'Phone sensors fire SOS automatically on a detected accident.',
        values: { free: false, premium: 'Add-on', premium_plus: true },
      },
    ],
  },
  {
    title: 'Emergency contacts',
    rows: [
      {
        label: 'Max contacts',
        values: { free: '3', premium: '5', premium_plus: '10' },
      },
      {
        label: 'Auto-SMS on SOS',
        hint: 'Contacts get an SMS with your name and live tracking link.',
        values: { free: true, premium: true, premium_plus: true },
      },
      {
        label: 'Live location link expires',
        values: { free: '15 min', premium: '60 min', premium_plus: '24 hours' },
      },
    ],
  },
  {
    title: 'Safe Mode and zones',
    rows: [
      {
        label: 'Live journey guard',
        hint: 'Auto-fires SOS if you don\'t confirm safe arrival by ETA.',
        values: { free: true, premium: true, premium_plus: true },
      },
      {
        label: 'Custom safe zones',
        hint: 'Saved spots like home, office, college; arrivals trigger alerts.',
        values: { free: false, premium: '3 zones', premium_plus: 'Unlimited' },
      },
      {
        label: 'Family arrival alerts',
        hint: 'Get a push when a circle member enters or leaves a safe zone.',
        values: { free: false, premium: false, premium_plus: true },
      },
    ],
  },
  {
    title: 'Friends and family circle',
    rows: [
      {
        label: 'Friends you can add',
        values: { free: '5', premium: '25', premium_plus: 'Unlimited' },
      },
      {
        label: 'Family dashboard',
        hint: 'Track up to 5 family members\' locations and SOS history.',
        values: { free: false, premium: false, premium_plus: true },
      },
      {
        label: 'Live location 24/7',
        hint: 'Continuous location share with circle members, not just on SOS.',
        values: { free: false, premium: false, premium_plus: true },
      },
    ],
  },
  {
    title: 'History and reports',
    rows: [
      {
        label: 'SOS history kept',
        values: { free: '30 days', premium: 'Forever', premium_plus: 'Forever' },
      },
      {
        label: 'Monthly safety report',
        values: { free: false, premium: true, premium_plus: true },
      },
      {
        label: 'Family safety report',
        values: { free: false, premium: false, premium_plus: true },
      },
    ],
  },
  {
    title: 'Support and ads',
    rows: [
      {
        label: 'Customer support',
        values: { free: 'Email', premium: 'Priority email', premium_plus: '24/7 helpline' },
      },
      {
        label: 'Ads inside the app',
        values: { free: 'Yes', premium: 'No', premium_plus: 'No' },
      },
    ],
  },
];

type WaitlistEntry = {
  email: string;
  plan: PlanId;
  createdAt: number;
};

async function joinWaitlist(entry: WaitlistEntry): Promise<void> {
  const existing = (await getItem<WaitlistEntry[]>(storageKeys.premiumWaitlist)) ?? [];
  const filtered = existing.filter(
    (e) => !(e.email === entry.email && e.plan === entry.plan),
  );
  filtered.unshift(entry);
  await setItem(storageKeys.premiumWaitlist, filtered);
}

export function PremiumUpgradeScreen() {
  const profile = useAppSelector((s) => s.user.profile);
  const isPremium = profile?.isPremium ?? false;
  const currentPlanId: PlanId = isPremium ? 'premium' : 'free';
  const [waitlistOpen, setWaitlistOpen] = useState<PlanId | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  const handleUpgradePress = (planId: PlanId) => {
    if (planId === currentPlanId) return;
    setWaitlistOpen(planId);
  };

  const submitWaitlist = async () => {
    const planId = waitlistOpen;
    if (!planId) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      Alert.alert('Invalid email', 'Enter a valid email so we can reach you.');
      return;
    }
    setSubmitting(true);
    try {
      await joinWaitlist({
        email: trimmed,
        plan: planId,
        createdAt: Date.now(),
      });
      trackEvent('premium_purchased', { plan: planId, waitlist: true });
      setWaitlistOpen(null);
      Alert.alert(
        "You're on the list",
        "We'll email you the moment paid plans go live. Thanks for backing ORBII early.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroWrap}>
          <Text style={styles.heroTitle}>Choose your plan</Text>
          <Text style={styles.heroBody}>
            Every row below tells you exactly what you get. Payments aren't live
            yet — join the waitlist on any paid plan and we'll email you the
            moment they switch on.
          </Text>
        </View>

        <View style={styles.planHeaderRow}>
          <View style={styles.featureColHeader} />
          {PLANS.map((plan) => (
            <View
              key={plan.id}
              style={[
                styles.planCol,
                plan.highlight && styles.planColHighlight,
                currentPlanId === plan.id && styles.planColCurrent,
              ]}
            >
              {plan.highlight ? (
                <View style={styles.popularPill}>
                  <Text style={styles.popularPillText}>POPULAR</Text>
                </View>
              ) : null}
              <Text style={[styles.planColName, plan.highlight && { color: colors.primary }]}>
                {plan.shortName}
              </Text>
              <Text style={styles.planColPrice}>{plan.priceLabel}</Text>
              <Text style={styles.planColPeriod}>{plan.perPeriod}</Text>
              {currentPlanId === plan.id ? (
                <Text style={styles.currentTag}>Your plan</Text>
              ) : null}
            </View>
          ))}
        </View>

        {FEATURE_GROUPS.map((group, groupIdx) => (
          <FeatureGroupCard key={group.title} group={group} index={groupIdx} />
        ))}

        <View style={styles.upgradeRow}>
          <View style={styles.upgradeRowSpacer} />
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            return (
              <View key={plan.id} style={styles.upgradeBtnWrap}>
                {isCurrent ? (
                  <View style={styles.currentBtn}>
                    <Text style={styles.currentBtnText}>Current</Text>
                  </View>
                ) : (
                  <UpgradeButton
                    label={plan.id === 'free' ? 'Stay free' : 'Waitlist'}
                    highlight={!!plan.highlight}
                    onPress={() => handleUpgradePress(plan.id)}
                  />
                )}
              </View>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          Pricing shown does not include GST. Prices and limits may change before
          launch as we gather feedback from the SRM pilot.
        </Text>
      </ScrollView>

      <WaitlistModal
        visible={waitlistOpen !== null}
        plan={waitlistOpen ? PLANS.find((p) => p.id === waitlistOpen) ?? null : null}
        email={email}
        onChangeEmail={setEmail}
        submitting={submitting}
        onClose={() => setWaitlistOpen(null)}
        onSubmit={submitWaitlist}
      />
    </ScreenContainer>
  );
}

// Each plan-table section fades + slides in with a per-index delay so the
// page reads top-to-bottom instead of all at once. Native driver keeps it
// at 60fps even on slow Androids.
function FeatureGroupCard({
  group,
  index,
}: {
  group: FeatureGroup;
  index: number;
}) {
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setTimeout(() => {
      Animated.timing(enter, {
        toValue: 1,
        duration: 380,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }, index * 80);
    return () => clearTimeout(id);
  }, [enter, index]);

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <Animated.View
      style={[styles.group, { opacity: enter, transform: [{ translateY }] }]}
    >
      <Text style={styles.groupTitle}>{group.title}</Text>
      <View style={styles.groupCard}>
        {group.rows.map((row, idx) => (
          <View key={row.label}>
            <View style={styles.featureRow}>
              <View style={styles.featureLabelCell}>
                <Text style={styles.featureLabel}>{row.label}</Text>
                {row.hint ? (
                  <Text style={styles.featureHint}>{row.hint}</Text>
                ) : null}
              </View>
              {PLANS.map((plan) => (
                <CellView key={plan.id} value={row.values[plan.id]} />
              ))}
            </View>
            {idx < group.rows.length - 1 ? (
              <View style={styles.divider} />
            ) : null}
          </View>
        ))}
      </View>
    </Animated.View>
  );
}

// Springy press feedback so the upgrade buttons feel tactile.
function UpgradeButton({
  label,
  highlight,
  onPress,
}: {
  label: string;
  highlight: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.94,
      speed: 40,
      bounciness: 0,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      speed: 30,
      bounciness: 8,
      useNativeDriver: true,
    }).start();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={[styles.upgradeBtn, highlight && styles.upgradeBtnHighlight]}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.upgradeBtnText,
            highlight && { color: colors.textInverse },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

function CellView({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <View style={styles.cell}>
        <Ionicons name="checkmark" size={18} color={colors.success} />
      </View>
    );
  }
  if (value === false) {
    return (
      <View style={styles.cell}>
        <Text style={styles.cellDash}>—</Text>
      </View>
    );
  }
  return (
    <View style={styles.cell}>
      <Text style={styles.cellText} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

function WaitlistModal({
  visible,
  plan,
  email,
  onChangeEmail,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  plan: Plan | null;
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
            <Text style={modalStyles.title}>
              {plan?.id === 'free' ? 'Stay on Free' : `${plan?.name ?? ''} waitlist`}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>

          {plan?.id === 'free' ? (
            <Text style={modalStyles.body}>
              No action needed. You're already on Free. You can switch to a paid
              plan anytime.
            </Text>
          ) : (
            <>
              <Text style={modalStyles.body}>
                Payments aren't live yet. Drop your email and we'll be in touch
                the moment {plan?.name} is available.
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
            </>
          )}
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

const FEATURE_LABEL_FLEX = 1.6;

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  heroWrap: {
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  planHeaderRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 4,
    marginTop: spacing.sm,
  },
  featureColHeader: {
    flex: FEATURE_LABEL_FLEX,
  },
  planCol: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 2,
    minHeight: 90,
  },
  planColHighlight: {
    backgroundColor: '#FFF7F7',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  planColCurrent: {
    borderWidth: 1,
    borderColor: colors.success,
  },
  popularPill: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.sm,
    marginBottom: 2,
  },
  popularPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 8,
    letterSpacing: 1,
    color: colors.textInverse,
  },
  planColName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  planColPrice: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 2,
  },
  planColPeriod: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 9,
    textAlign: 'center',
  },
  currentTag: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.success,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  group: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  groupTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.xs,
  },
  groupCard: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    gap: 4,
  },
  featureLabelCell: {
    flex: FEATURE_LABEL_FLEX,
    paddingRight: spacing.xs,
  },
  featureLabel: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13,
    color: colors.textPrimary,
  },
  featureHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 14,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  cellText: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  cellDash: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.sm,
  },
  upgradeRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: spacing.md,
    alignItems: 'stretch',
  },
  upgradeRowSpacer: {
    flex: FEATURE_LABEL_FLEX,
  },
  upgradeBtnWrap: {
    flex: 1,
  },
  upgradeBtn: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.primary,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  upgradeBtnHighlight: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  upgradeBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.primary,
    fontSize: 12,
    letterSpacing: 0.4,
  },
  currentBtn: {
    backgroundColor: colors.surface,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.success,
  },
  currentBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.success,
    fontSize: 12,
    letterSpacing: 0.5,
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
