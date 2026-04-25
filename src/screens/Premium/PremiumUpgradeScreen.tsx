import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
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

// 3-tier plan structure. We don't ship Razorpay yet — the "Upgrade" button
// captures interest into a local waitlist instead, so we have a list of
// people to email when payments go live.
type PlanId = 'free' | 'premium' | 'premium_plus';

type Plan = {
  id: PlanId;
  name: string;
  priceLabel: string;
  perMonth: string;
  badge?: string;
  highlight?: boolean;
  pitch: string;
  features: Array<{ supported: boolean; label: string }>;
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    priceLabel: '₹0',
    perMonth: 'forever',
    pitch: 'Everything you need to send help in 2 minutes.',
    features: [
      { supported: true, label: '2 SOS per month' },
      { supported: true, label: 'Standard helper dispatch' },
      { supported: true, label: 'Up to 3 emergency contacts' },
      { supported: true, label: '30-day SOS history' },
      { supported: false, label: 'Voice detection' },
      { supported: false, label: 'Priority dispatch' },
      { supported: false, label: 'Family dashboard' },
      { supported: false, label: 'Safe zones' },
    ],
  },
  {
    id: 'premium',
    name: 'Premium',
    priceLabel: '₹99',
    perMonth: 'per month',
    badge: 'Most popular',
    highlight: true,
    pitch: 'For people who want voice triggers and priority help.',
    features: [
      { supported: true, label: 'Unlimited SOS' },
      { supported: true, label: 'Priority dispatch, helpers see you first' },
      { supported: true, label: 'Up to 5 emergency contacts' },
      { supported: true, label: 'Full SOS history (forever)' },
      { supported: true, label: 'Voice detection: "help" or "bachao"' },
      { supported: true, label: 'Safe zones with arrival/leave alerts' },
      { supported: true, label: 'Monthly safety report' },
      { supported: true, label: 'No ads' },
    ],
  },
  {
    id: 'premium_plus',
    name: 'Premium Plus',
    priceLabel: '₹299',
    perMonth: 'per month',
    pitch: 'Watch over your family, all in one dashboard.',
    features: [
      { supported: true, label: 'Everything in Premium' },
      { supported: true, label: 'Family dashboard: track up to 5 members' },
      { supported: true, label: 'Live location sharing 24/7' },
      { supported: true, label: 'Geofencing alerts' },
      { supported: true, label: 'Unlimited custom safe zones' },
      { supported: true, label: 'Priority 24/7 helpline' },
      { supported: true, label: 'Monthly family safety report' },
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
  // De-dupe on (email, plan) so multiple taps don't bloat the list.
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

  const currentPlanLabel = useMemo(
    () => PLANS.find((p) => p.id === currentPlanId)?.name ?? 'Free',
    [currentPlanId],
  );

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
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          <View style={styles.currentPill}>
            <Ionicons name="checkmark-circle" size={14} color={colors.success} />
            <Text style={styles.currentPillText}>
              You're on {currentPlanLabel}
            </Text>
          </View>
          <Text style={styles.heroTitle}>Choose your plan</Text>
          <Text style={styles.heroBody}>
            Payments aren't live yet. Join the waitlist on any paid plan and
            we'll email you when they switch on.
          </Text>
        </View>

        <View style={styles.plansList}>
          {PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isCurrent={plan.id === currentPlanId}
              onPress={() => handleUpgradePress(plan.id)}
            />
          ))}
        </View>
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

function PlanCard({
  plan,
  isCurrent,
  onPress,
}: {
  plan: Plan;
  isCurrent: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={[
        styles.planCard,
        plan.highlight && styles.planCardHighlight,
      ]}
    >
      {plan.badge ? (
        <View style={styles.planBadge}>
          <Text style={styles.planBadgeText}>{plan.badge}</Text>
        </View>
      ) : null}

      <View style={styles.planHeader}>
        <Text style={styles.planName}>{plan.name}</Text>
        <View style={styles.priceRow}>
          <Text
            style={[
              styles.planPrice,
              plan.highlight && { color: colors.primary },
            ]}
          >
            {plan.priceLabel}
          </Text>
          <Text style={styles.planPriceMeta}>{plan.perMonth}</Text>
        </View>
      </View>

      <Text style={styles.planPitch}>{plan.pitch}</Text>

      <View style={styles.featureList}>
        {plan.features.map((feat) => (
          <View key={feat.label} style={styles.featureRow}>
            <Ionicons
              name={feat.supported ? 'checkmark-circle' : 'close-circle'}
              size={16}
              color={feat.supported ? colors.success : colors.textMuted}
            />
            <Text
              style={[
                styles.featureText,
                !feat.supported && { color: colors.textMuted },
              ]}
            >
              {feat.label}
            </Text>
          </View>
        ))}
      </View>

      {isCurrent ? (
        <View style={styles.currentBtn}>
          <Text style={styles.currentBtnText}>Current plan</Text>
        </View>
      ) : (
        <Button
          label={plan.id === 'free' ? 'Stay on Free' : 'Join waitlist'}
          onPress={onPress}
          variant={plan.highlight ? 'primary' : 'outline'}
        />
      )}
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
              No action needed. You're already on Free. You can switch to a
              paid plan anytime.
            </Text>
          ) : (
            <>
              <Text style={modalStyles.body}>
                Payments aren't live yet. Drop your email and we'll be in
                touch the moment {plan?.name} is available.
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

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
  },
  heroWrap: {
    gap: spacing.sm,
    alignItems: 'center',
  },
  currentPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  currentPillText: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsMedium,
    color: colors.textPrimary,
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  plansList: {
    gap: spacing.md,
  },
  planCard: {
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  planCardHighlight: {
    borderColor: colors.primary,
    borderWidth: 2,
  },
  planBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  planBadgeText: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textInverse,
    fontSize: 10,
    letterSpacing: 1,
  },
  planHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  planName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  planPrice: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  planPriceMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  planPitch: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
  },
  featureList: {
    gap: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  featureText: {
    ...typography.body,
    color: colors.textPrimary,
    fontSize: 13,
    flex: 1,
  },
  currentBtn: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  currentBtnText: {
    ...typography.body,
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textSecondary,
    fontSize: 13,
    letterSpacing: 1,
  },
});
