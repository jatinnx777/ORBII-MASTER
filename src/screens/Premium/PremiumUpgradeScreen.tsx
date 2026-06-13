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
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Mascot } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { premiumUpgraded } from '@/redux/slices/userSlice';
import { trackEvent } from '@/services/analytics';
import { getItem, setItem, storageKeys } from '@/services/storage';

// The launch promo code. Entering this in the coupon field unlocks every
// Premium feature for free (stored on the local profile via premiumUpgraded).
const PROMO_CODE = 'ORBII';

// Three tiers per the product spec: Free (₹0), Solo (₹99/mo), Family
// (₹299/mo) + a coupon field. Payments aren't live yet — choosing a paid
// plan captures a waitlist email (honest "coming soon").

type PlanId = 'free' | 'solo' | 'family';

type Plan = {
  id: PlanId;
  name: string;
  price: number;
  tagline: string;
  highlight?: boolean;
  badge?: string;
  valueNote?: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    tagline: 'Everything you need to stay safe.',
    features: [
      'Emergency SOS',
      'Live Location',
      'Nearby Helpers',
      'Emergency Contacts',
      '2 Voice SOS activations / month',
    ],
  },
  {
    id: 'solo',
    name: 'Solo',
    price: 99,
    tagline: 'Hands-free protection, always on.',
    highlight: true,
    badge: 'RECOMMENDED',
    features: [
      'Everything in Free',
      'Unlimited Voice SOS',
      'Priority Alerts',
      'Advanced safety features',
    ],
  },
  {
    id: 'family',
    name: 'Family',
    price: 299,
    tagline: 'Protect everyone you love.',
    badge: 'BEST FOR FAMILIES',
    valueNote: 'Just ₹75 per person',
    features: [
      'Up to 4 family members',
      'Shared safety circle',
      'Unlimited Voice SOS',
      'Family dashboard',
    ],
  },
];

function formatPrice(amount: number): string {
  return amount === 0 ? '₹0' : `₹${amount.toLocaleString('en-IN')}`;
}

type WaitlistEntry = {
  email: string;
  plan: PlanId;
  coupon: string | null;
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
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const isPremium = profile?.isPremium ?? false;
  const [waitlistOpen, setWaitlistOpen] = useState<PlanId | null>(null);
  const [email, setEmail] = useState(profile?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);

  useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  const applyCoupon = () => {
    const code = coupon.trim().toUpperCase();
    if (!code) {
      Alert.alert('Enter a code', 'Type a coupon code first.');
      return;
    }
    if (code === PROMO_CODE) {
      dispatch(premiumUpgraded());
      setCouponApplied(true);
      trackEvent('premium_purchased', { plan: 'coupon', coupon: code });
      Alert.alert(
        '🎉 Premium unlocked!',
        'Your ORBII coupon is applied. Every Premium feature is now free for you.',
      );
      return;
    }
    setCouponApplied(false);
    Alert.alert('Invalid code', `"${code}" isn't a valid coupon. Try ORBII.`);
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
        coupon: couponApplied ? coupon.trim().toUpperCase() : null,
        createdAt: Date.now(),
      });
      trackEvent('premium_purchased', { plan: planId, waitlist: true });
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
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Mascot pose={isPremium ? 'celebrate' : 'shield'} size={120} />
            <Text style={styles.heroTitle}>
              {isPremium ? 'Premium active' : 'Choose your plan'}
            </Text>
            <Text style={styles.heroBody}>
              {isPremium
                ? 'Every Premium feature is unlocked for you. Thank you for being an early ORBII member.'
                : 'Start free. Upgrade anytime for unlimited Voice SOS and family protection.'}
            </Text>
          </View>

          {isPremium ? (
            <View style={styles.premiumBanner}>
              <Ionicons name="sparkles" size={16} color={colors.goldDeep} />
              <Text style={styles.premiumBannerText}>
                Premium unlocked with the ORBII coupon
              </Text>
            </View>
          ) : null}

          {PLANS.map((plan, index) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              index={index}
              current={plan.id === 'free' && !isPremium}
              onPress={() => setWaitlistOpen(plan.id)}
            />
          ))}

          {/* coupon */}
          <View style={styles.couponCard}>
            <Text style={styles.couponLabel}>Have a coupon code?</Text>
            <View style={styles.couponRow}>
              <TextInput
                value={coupon}
                onChangeText={(v) => {
                  setCoupon(v);
                  setCouponApplied(false);
                }}
                placeholder="Enter code"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                style={styles.couponInput}
              />
              <Pressable
                onPress={applyCoupon}
                style={({ pressed }) => [
                  styles.applyBtn,
                  couponApplied && styles.applyBtnDone,
                  pressed && { opacity: 0.9 },
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.applyText}>
                  {couponApplied ? 'Applied' : 'Apply'}
                </Text>
              </Pressable>
            </View>
          </View>

          <Text style={styles.footnote}>
            Prices in INR per month, taxes included. Payments aren't live yet.
            You'll be the first to know when they switch on.
          </Text>
        </ScrollView>
      </SafeAreaView>

      <WaitlistModal
        visible={waitlistOpen !== null}
        plan={waitlistOpen ? PLANS.find((p) => p.id === waitlistOpen) ?? null : null}
        email={email}
        onChangeEmail={setEmail}
        submitting={submitting}
        onClose={() => setWaitlistOpen(null)}
        onSubmit={submitWaitlist}
      />
    </View>
  );
}

function PlanCard({
  plan,
  index,
  current,
  onPress,
}: {
  plan: Plan;
  index: number;
  current: boolean;
  onPress: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      delay: index * 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, index]);
  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <Animated.View
      style={[
        styles.planCard,
        plan.highlight && styles.planCardHighlight,
        { opacity: enter, transform: [{ translateY }] },
      ]}
    >
      {plan.badge ? (
        <View style={[styles.popularPill, !plan.highlight && styles.popularPillMuted]}>
          <Text style={[styles.popularPillText, !plan.highlight && styles.popularPillTextMuted]}>
            {plan.badge}
          </Text>
        </View>
      ) : null}

      <View style={styles.planHead}>
        <Text style={styles.planName}>{plan.name}</Text>
        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatPrice(plan.price)}</Text>
          <Text style={styles.priceSuffix}>{plan.price === 0 ? '' : '/mo'}</Text>
        </View>
      </View>
      <Text style={styles.planTagline}>{plan.tagline}</Text>
      {plan.valueNote ? (
        <View style={styles.valueNote}>
          <Ionicons name="pricetag" size={12} color={colors.sageDeep} />
          <Text style={styles.valueNoteText}>{plan.valueNote}</Text>
        </View>
      ) : null}

      <View style={styles.divider} />

      {plan.features.map((feature) => (
        <View key={feature} style={styles.featureRow}>
          <View style={styles.featureCheck}>
            <Ionicons name="checkmark" size={13} color={colors.textInverse} />
          </View>
          <Text style={styles.featureText}>{feature}</Text>
        </View>
      ))}

      <View style={{ height: spacing.md }} />

      {current ? (
        <View style={styles.currentBtn}>
          <Ionicons name="checkmark-circle" size={18} color={colors.sageDeep} />
          <Text style={styles.currentBtnText}>Your current plan</Text>
        </View>
      ) : (
        <Button
          label={plan.highlight ? `Get ${plan.name}` : `Choose ${plan.name}`}
          variant={plan.highlight ? 'primary' : 'secondary'}
          onPress={onPress}
        />
      )}
    </Animated.View>
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
  onChangeEmail: (v: string) => void;
  submitting: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          <Mascot pose="headset" size={84} />
          <Text style={styles.sheetTitle}>
            {plan ? `${plan.name} — ${formatPrice(plan.price)}/mo` : ''}
          </Text>
          <Text style={styles.sheetBody}>
            Payments aren't live yet. Drop your email and we'll let you know the
            moment they switch on for India.
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
          <Pressable onPress={onClose} style={styles.dismissBtn} accessibilityRole="button">
            <Text style={styles.dismissText}>Not now</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1 },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
    gap: spacing.md,
  },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  heroTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },
  premiumBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.goldSoft,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  premiumBannerText: {
    ...typography.label,
    color: colors.goldDeep,
  },
  planCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    ...shadows.card,
  },
  planCardHighlight: {
    borderWidth: 2,
    borderColor: colors.peach,
  },
  popularPill: {
    position: 'absolute',
    top: -10,
    right: spacing.lg,
    backgroundColor: colors.peach,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  popularPillMuted: {
    backgroundColor: colors.lavenderSoft,
  },
  popularPillText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 10,
    color: colors.textPrimary,
    letterSpacing: 0.6,
  },
  popularPillTextMuted: {
    color: colors.lavenderDeep,
  },
  valueNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.sageSoft,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
  },
  valueNoteText: {
    ...typography.caption,
    fontSize: 11.5,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.sageDeep,
  },
  planHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  planName: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
  },
  price: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 28,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  priceSuffix: {
    ...typography.label,
    color: colors.textSecondary,
  },
  planTagline: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
  },
  featureCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    ...typography.bodyMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  currentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.sageSoft,
  },
  currentBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: colors.sageDeep,
  },
  couponCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  couponLabel: {
    ...typography.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  couponRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  couponInput: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    color: colors.textPrimary,
    letterSpacing: 1,
  },
  applyBtn: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  applyBtnDone: {
    backgroundColor: colors.sageSoft,
  },
  applyText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: colors.textPrimary,
  },
  footnote: {
    ...typography.caption,
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
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDeep,
    marginBottom: spacing.sm,
  },
  sheetTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  sheetBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  input: {
    alignSelf: 'stretch',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textPrimary,
    ...shadows.icon,
  },
  dismissBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  dismissText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
  },
});
