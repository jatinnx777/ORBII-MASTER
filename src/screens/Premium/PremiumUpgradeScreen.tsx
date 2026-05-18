import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
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
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { trackEvent } from '@/services/analytics';
import { getItem, setItem, storageKeys } from '@/services/storage';

// Three subscription tiers — Silver / Gold / Platinum — with a billing
// cycle toggle (Weekly / Monthly / Yearly). Yearly offers the biggest
// discount. Payments are not live yet; the upgrade buttons capture
// waitlist emails.

type PlanId = 'silver' | 'gold' | 'platinum';
type BillingCycle = 'weekly' | 'monthly' | 'yearly';

type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  badge: string;
  badgeColor: string;
  highlight?: boolean;
  prices: Record<BillingCycle, number>;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: 'silver',
    name: 'Silver',
    tagline: 'Crime visibility for your area.',
    badge: 'SILVER',
    badgeColor: '#E6E8EC',
    prices: { weekly: 29, monthly: 99, yearly: 899 },
    features: [
      'Crime Reports near you',
      'Basic priority on SOS dispatch',
      'Limited SOS history (90 days)',
      'Email support',
    ],
  },
  {
    id: 'gold',
    name: 'Gold',
    tagline: 'Priority response when it matters.',
    badge: 'GOLD',
    badgeColor: '#FFF1CB',
    highlight: true,
    prices: { weekly: 59, monthly: 199, yearly: 1799 },
    features: [
      'Everything in Silver',
      'Priority alert delivery',
      'Faster response routing',
      'Extended location tracking',
      'Priority support',
    ],
  },
  {
    id: 'platinum',
    name: 'Platinum',
    tagline: 'Full intelligence layer.',
    badge: 'PLATINUM',
    badgeColor: '#E6EAFF',
    prices: { weekly: 99, monthly: 299, yearly: 2699 },
    features: [
      'Everything in Gold',
      'Travel Safety Heatmap',
      'Advanced safety insights',
      'Family dashboard (up to 5)',
      '24/7 helpline',
    ],
  },
];

const CYCLES: { id: BillingCycle; label: string; suffix: string }[] = [
  { id: 'weekly', label: 'Weekly', suffix: '/wk' },
  { id: 'monthly', label: 'Monthly', suffix: '/mo' },
  { id: 'yearly', label: 'Yearly', suffix: '/yr' },
];

function formatPrice(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

function savingsText(plan: Plan, cycle: BillingCycle): string | null {
  if (cycle !== 'yearly') return null;
  const monthlyAnnualised = plan.prices.monthly * 12;
  const saved = monthlyAnnualised - plan.prices.yearly;
  if (saved <= 0) return null;
  const pct = Math.round((saved / monthlyAnnualised) * 100);
  return `Save ${pct}% vs monthly`;
}

type WaitlistEntry = {
  email: string;
  plan: PlanId;
  cycle: BillingCycle;
  createdAt: number;
};

async function joinWaitlist(entry: WaitlistEntry): Promise<void> {
  const existing =
    (await getItem<WaitlistEntry[]>(storageKeys.premiumWaitlist)) ?? [];
  const filtered = existing.filter(
    (e) => !(e.email === entry.email && e.plan === entry.plan),
  );
  filtered.unshift(entry);
  await setItem(storageKeys.premiumWaitlist, filtered);
}

export function PremiumUpgradeScreen() {
  const profile = useAppSelector((s) => s.user.profile);
  const isPremium = profile?.isPremium ?? false;
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [waitlistOpen, setWaitlistOpen] = useState<PlanId | null>(null);
  const [email, setEmail] = useState(profile?.email ?? '');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  const handleUpgrade = (planId: PlanId) => {
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
        cycle,
        createdAt: Date.now(),
      });
      trackEvent('premium_purchased', {
        plan: planId,
        cycle,
        waitlist: true,
      });
      setWaitlistOpen(null);
      Alert.alert(
        "You're on the list",
        "We'll email you the moment paid plans go live.",
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
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Upgrade your safety net</Text>
          <Text style={styles.heroBody}>
            Unlock crime visibility, faster response, and family-grade
            insights. Cancel anytime.
          </Text>
        </View>

        <CycleToggle value={cycle} onChange={setCycle} />

        {PLANS.map((plan, index) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            cycle={cycle}
            index={index}
            current={isPremium && plan.id === 'platinum'}
            onPress={() => handleUpgrade(plan.id)}
          />
        ))}

        <Text style={styles.footnote}>
          Pricing excludes GST. Plans and limits may evolve as we gather
          feedback from the SRM pilot.
        </Text>
      </ScrollView>

      <WaitlistModal
        visible={waitlistOpen !== null}
        plan={waitlistOpen ? PLANS.find((p) => p.id === waitlistOpen) ?? null : null}
        cycle={cycle}
        email={email}
        onChangeEmail={setEmail}
        submitting={submitting}
        onClose={() => setWaitlistOpen(null)}
        onSubmit={submitWaitlist}
      />
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Billing cycle toggle
// ---------------------------------------------------------------------------

function CycleToggle({
  value,
  onChange,
}: {
  value: BillingCycle;
  onChange: (v: BillingCycle) => void;
}) {
  return (
    <View style={styles.cycleWrap}>
      {CYCLES.map((c) => {
        const active = c.id === value;
        return (
          <Pressable
            key={c.id}
            onPress={() => onChange(c.id)}
            style={[styles.cycleBtn, active && styles.cycleBtnActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.cycleLabel,
                active && styles.cycleLabelActive,
              ]}
            >
              {c.label}
            </Text>
            {c.id === 'yearly' ? (
              <View style={styles.bestPill}>
                <Text style={styles.bestPillText}>BEST VALUE</Text>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Plan card
// ---------------------------------------------------------------------------

function PlanCard({
  plan,
  cycle,
  index,
  current,
  onPress,
}: {
  plan: Plan;
  cycle: BillingCycle;
  index: number;
  current: boolean;
  onPress: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: index * 70,
      useNativeDriver: true,
    }).start();
  }, [enter, index]);

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  const cycleSuffix = CYCLES.find((c) => c.id === cycle)?.suffix ?? '';
  const savings = savingsText(plan, cycle);

  return (
    <Animated.View
      style={[
        styles.planCard,
        plan.highlight && styles.planCardHighlight,
        { opacity: enter, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.planHead}>
        <View
          style={[styles.planBadge, { backgroundColor: plan.badgeColor }]}
        >
          <Text style={styles.planBadgeText}>{plan.badge}</Text>
        </View>
        {plan.highlight ? (
          <View style={styles.popularPill}>
            <Text style={styles.popularPillText}>MOST POPULAR</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.planName}>{plan.name}</Text>
      <Text style={styles.planTagline}>{plan.tagline}</Text>

      <View style={styles.priceRow}>
        <Text style={styles.price}>{formatPrice(plan.prices[cycle])}</Text>
        <Text style={styles.priceSuffix}>{cycleSuffix}</Text>
      </View>
      {savings ? <Text style={styles.savings}>{savings}</Text> : null}

      <View style={styles.divider} />

      {plan.features.map((feature) => (
        <View key={feature} style={styles.featureRow}>
          <Ionicons
            name="checkmark"
            size={16}
            color={colors.brandDeep}
            style={styles.featureIcon}
          />
          <Text style={styles.featureText}>{feature}</Text>
        </View>
      ))}

      <View style={{ height: spacing.sm }} />

      {current ? (
        <View style={styles.currentBtn}>
          <Ionicons name="checkmark-circle" size={16} color={colors.brandDeep} />
          <Text style={styles.currentBtnText}>Your current plan</Text>
        </View>
      ) : (
        <Button
          label={plan.highlight ? 'Join waitlist' : 'Choose plan'}
          variant={plan.highlight ? 'primary' : 'outline'}
          onPress={onPress}
        />
      )}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// Waitlist modal
// ---------------------------------------------------------------------------

function WaitlistModal({
  visible,
  plan,
  cycle,
  email,
  onChangeEmail,
  submitting,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  plan: Plan | null;
  cycle: BillingCycle;
  email: string;
  onChangeEmail: (v: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const cycleSuffix = CYCLES.find((c) => c.id === cycle)?.suffix ?? '';
  const priceLabel = plan
    ? `${formatPrice(plan.prices[cycle])}${cycleSuffix}`
    : '';

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {plan ? `${plan.name} — ${priceLabel}` : ''}
          </Text>
          <Text style={styles.sheetBody}>
            Payments aren't live yet. Drop your email and we'll let you know
            the moment they switch on for India.
          </Text>
          <TextInput
            value={email}
            onChangeText={onChangeEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            style={styles.input}
          />
          <View style={{ height: spacing.sm }} />
          <Button
            label={submitting ? 'Saving…' : 'Notify me'}
            onPress={onSubmit}
            loading={submitting}
          />
          <Pressable
            onPress={onClose}
            style={styles.dismissBtn}
            accessibilityRole="button"
          >
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
    gap: spacing.md,
  },
  hero: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.xs,
    gap: 4,
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  cycleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.circle,
    padding: 4,
    gap: 4,
  },
  cycleBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.circle,
    flexDirection: 'row',
    gap: 6,
  },
  cycleBtnActive: {
    backgroundColor: colors.background,
    ...shadows.card,
  },
  cycleLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
  cycleLabelActive: {
    color: colors.textPrimary,
  },
  bestPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.circle,
    backgroundColor: colors.brand,
  },
  bestPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 8,
    color: colors.textInverse,
    letterSpacing: 0.5,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  planCardHighlight: {
    borderColor: colors.brand,
    borderWidth: 1.5,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  planBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.circle,
  },
  planBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.textPrimary,
    letterSpacing: 0.8,
  },
  popularPill: {
    backgroundColor: colors.brand,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.circle,
  },
  popularPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.textInverse,
    letterSpacing: 0.8,
  },
  planName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    marginTop: 10,
  },
  planTagline: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginTop: spacing.sm,
    gap: 4,
  },
  price: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 32,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  priceSuffix: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    color: colors.textSecondary,
  },
  savings: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.brandDeep,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 4,
  },
  featureIcon: {
    marginTop: 1,
  },
  featureText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  currentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  currentBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.brandDeep,
  },
  footnote: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    lineHeight: 16,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  sheetBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  dismissBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  dismissText: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
