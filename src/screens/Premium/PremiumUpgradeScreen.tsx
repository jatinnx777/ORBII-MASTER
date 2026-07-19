import React, { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
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
import { premiumUpgraded, premiumTierResolved } from '@/redux/slices/userSlice';
import {
  purchasePlan,
  resolvePremiumTier,
  markCouponRedeemed,
  type PlanId as PaidPlanId,
  type PremiumTier,
} from '@/services/razorpay';
import { trackEvent } from '@/services/analytics';
import { getItem, setItem, storageKeys } from '@/services/storage';

// The launch promo code. Entering this in the coupon field unlocks every
// Premium feature for free (stored on the local profile via premiumUpgraded).
const PROMO_CODE = 'ORBII';

// Three tiers per the product spec: Free (₹0), Solo (₹99/mo), Family
// (₹299/mo) + a coupon field. Payments aren't live yet — choosing a paid
// plan captures a waitlist email (honest "coming soon").

type PlanId = 'free' | 'solo' | 'family';

// How a plan card presents relative to what the user already owns:
//  buy      — not premium yet, show the price + purchase button
//  current  — the exact plan they're on right now
//  included — a lower tier that's already covered by their plan
//  upgrade  — a higher tier, framed as an upgrade (no re-sell)
type CardState = 'buy' | 'current' | 'included' | 'upgrade';

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

// Life360-style: lead with the main paid tier (Plus ₹99), highlighted as the
// recommended plan, then Family, then Free at the bottom.
const PLANS: Plan[] = [
  {
    id: 'solo',
    name: 'ORBII Plus',
    price: 99,
    tagline: 'Verified responders, unlimited voice & full protection.',
    highlight: true,
    badge: 'MOST POPULAR',
    valueNote: 'Less than one late-night cab home',
    features: [
      'Verified responders dispatched to you nearby',
      'Unlimited hands-free Voice SOS',
      'Always-on background voice monitoring',
      'Family Circles + real-time tracking during SOS',
      'Priority helper matching + live ETA',
      'Advanced Protection Strength',
      'Dead Man’s Switch & Trusted Places',
      'WhatsApp emergency automation',
    ],
  },
  {
    id: 'family',
    name: 'ORBII Family',
    price: 299,
    tagline: 'One plan that protects your whole family.',
    badge: 'BEST VALUE',
    valueNote: 'Protect up to 4 people',
    features: [
      'Everything in ORBII Plus, for 4 family members',
      'Verified responders for every member',
      'Unlimited hands-free Voice SOS for all',
      'Shared family circle with live tracking',
      'Priority helper matching + live ETA',
    ],
  },
  {
    id: 'free',
    name: 'ORBII Free',
    price: 0,
    tagline: 'Core emergency protection, free forever.',
    features: [
      'Unlimited manual SOS button',
      'Live location shared with your family circle',
      'Up to 3 emergency contacts',
      'Auto audio recording during SOS',
      'Safe Journey mode',
      'SOS history (last 7 days)',
      '2 hands-free Voice SOS per month',
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
  // The tier drives the whole screen: what shows as "current", what becomes an
  // "upgrade", and what disappears entirely (a plan you already own).
  const tier: PremiumTier = profile?.premiumTier ?? (isPremium ? 'plus' : 'none');
  const [waitlistOpen, setWaitlistOpen] = useState<PlanId | null>(null);
  const [email, setEmail] = useState(profile?.email ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [paying, setPaying] = useState<PaidPlanId | null>(null);
  // Celebration shown after a successful purchase / coupon redemption.
  const [thankYou, setThankYou] = useState<'plus' | 'family' | null>(null);

  useEffect(() => {
    trackEvent('premium_viewed');
    // Sync the active tier from server + local records so premium persists
    // across re-login / reinstall and a lapsed month downgrades cleanly.
    resolvePremiumTier().then((resolved) => {
      // null = unknown, not 'none'. Never downgrade on a failed read.
      if (resolved) dispatch(premiumTierResolved(resolved));
    });
  }, [dispatch]);

  // Live Razorpay (test mode) checkout for a paid plan.
  const handlePay = async (planId: PaidPlanId) => {
    if (paying) return;
    setPaying(planId);
    try {
      const result = await purchasePlan(planId);
      if (result.ok) {
        const boughtTier = planId === 'family' ? 'family' : 'plus';
        dispatch(premiumUpgraded(boughtTier));
        trackEvent('premium_purchased', { plan: planId });
        setThankYou(boughtTier);
      } else if (result.cancelled) {
        // Silent — the user chose to cancel.
      } else {
        appAlert('Payment failed', result.error ?? 'Please try again.');
      }
    } finally {
      setPaying(null);
    }
  };

  const applyCoupon = () => {
    const code = coupon.trim().toUpperCase();
    if (!code) {
      appAlert('Enter a code', 'Type a coupon code first.');
      return;
    }
    if (code === PROMO_CODE) {
      // The ORBII gift code unlocks ORBII Plus (₹99 tier) free for one month.
      dispatch(premiumUpgraded('plus'));
      markCouponRedeemed();
      setCouponApplied(true);
      trackEvent('premium_purchased', { plan: 'coupon', coupon: code });
      setThankYou('plus');
      return;
    }
    setCouponApplied(false);
    appAlert('Invalid code', `"${code}" isn't a valid coupon. Try ORBII.`);
  };

  // What each plan card should render, given the tier the user already owns.
  const RANK: Record<PlanId, number> = { free: 0, solo: 1, family: 2 };
  const tierRank = tier === 'family' ? 2 : tier === 'plus' ? 1 : 0;
  const cardStateFor = (planId: PlanId): CardState => {
    if (RANK[planId] === tierRank) return 'current';
    if (RANK[planId] < tierRank) return 'included';
    return tierRank === 0 ? 'buy' : 'upgrade';
  };

  const submitWaitlist = async () => {
    const planId = waitlistOpen;
    if (!planId) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(trimmed)) {
      appAlert('Invalid email', 'Enter a valid email so we can reach you.');
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
      appAlert(
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
              {tier === 'family'
                ? 'ORBII Family active'
                : tier === 'plus'
                  ? 'ORBII Plus active'
                  : 'Choose your plan'}
            </Text>
            <Text style={styles.heroBody}>
              {tier === 'family'
                ? 'Your whole family is protected. Every Premium feature is unlocked.'
                : tier === 'plus'
                  ? 'You have full protection. Upgrade to Family anytime to cover up to 4 people.'
                  : 'Start free. Upgrade anytime for unlimited Voice SOS and family protection.'}
            </Text>
          </View>

          {isPremium ? (
            <View style={styles.premiumBanner}>
              <Ionicons name="sparkles" size={16} color={colors.goldDeep} />
              <Text style={styles.premiumBannerText}>
                {tier === 'family'
                  ? "You're on ORBII Family"
                  : "You're on ORBII Plus"}
              </Text>
            </View>
          ) : null}

          {!isPremium ? (
            <Text style={styles.valueLine}>
              Full protection for <Text style={styles.valueStrong}>less than ₹4 a day</Text>. Cancel anytime.
            </Text>
          ) : null}

          {PLANS.map((plan, index) => {
            const state = cardStateFor(plan.id);
            return (
              <PlanCard
                key={plan.id}
                plan={plan}
                index={index}
                state={state}
                loading={paying === plan.id}
                onPress={() => {
                  if (plan.id === 'free' || state === 'current' || state === 'included') return;
                  handlePay(plan.id as PaidPlanId);
                }}
              />
            );
          })}

          {!isPremium ? (
            <>
              {/* Trust strip — the reassurances that actually convert on a paid
                  screen: safe payment, no lock-in, instant value. */}
              <View style={styles.trustStrip}>
                {[
                  { icon: 'lock-closed' as const, label: 'Secure\npayment' },
                  { icon: 'close-circle' as const, label: 'Cancel\nanytime' },
                  { icon: 'flash' as const, label: 'Instant\nactivation' },
                ].map((t) => (
                  <View key={t.label} style={styles.trustItem}>
                    <View style={styles.trustIcon}>
                      <Ionicons name={t.icon} size={17} color={colors.brandDeep} />
                    </View>
                    <Text style={styles.trustLabel}>{t.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.socialProof}>
                <Ionicons name="shield-checkmark" size={14} color={colors.sageDeep} />
                <Text style={styles.socialText}>
                  Payments are handled securely by Razorpay. Your card details never touch ORBII.
                </Text>
              </View>
            </>
          ) : null}

          {/* gift code — only while there's nothing to gift-unlock yet. Once
              premium, we never ask the user to redeem or buy again. */}
          {!isPremium ? (
          <View style={styles.couponCard}>
            <View style={styles.giftRow}>
              <Ionicons name="gift" size={16} color={colors.peachDeep} />
              <Text style={styles.couponLabel}>Have a gift code?</Text>
            </View>
            <Text style={styles.giftHint}>
              Early members get full Premium as our gift.
            </Text>
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
          ) : null}

          <Text style={styles.footnote}>
            Prices in INR per month, taxes included. Secure payments by Razorpay.
            Cancel anytime. Your protection never depends on paying.
          </Text>
        </ScrollView>
      </SafeAreaView>

      <ThankYouModal tier={thankYou} onClose={() => setThankYou(null)} />

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
  state,
  loading,
  onPress,
}: {
  plan: Plan;
  index: number;
  state: CardState;
  loading?: boolean;
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

      {state === 'current' ? (
        <View style={styles.currentBtn}>
          <Ionicons name="checkmark-circle" size={18} color={colors.sageDeep} />
          <Text style={styles.currentBtnText}>Your current plan</Text>
        </View>
      ) : state === 'included' ? (
        <View style={styles.includedBtn}>
          <Ionicons name="checkmark-circle" size={16} color={colors.textMuted} />
          <Text style={styles.includedBtnText}>Included in your plan</Text>
        </View>
      ) : state === 'upgrade' ? (
        <Button
          label={`Upgrade to ${plan.name}`}
          variant="primary"
          loading={loading}
          onPress={onPress}
        />
      ) : (
        <Button
          label={plan.highlight ? `Get ${plan.name} · ₹${plan.price}/mo` : `Choose ${plan.name}`}
          variant={plan.highlight ? 'primary' : 'secondary'}
          loading={loading}
          onPress={onPress}
        />
      )}
    </Animated.View>
  );
}

// Celebration after a successful purchase / coupon redemption. Warm, on-brand
// thank-you instead of a plain OS-style alert — the moment should feel special.
function ThankYouModal({
  tier,
  onClose,
}: {
  tier: 'plus' | 'family' | null;
  onClose: () => void;
}) {
  const name = tier === 'family' ? 'ORBII Family' : 'ORBII Plus';
  return (
    <Modal visible={tier !== null} animationType="fade" transparent>
      <View style={styles.thanksBackdrop}>
        <View style={styles.thanksCard}>
          <Mascot pose="celebrate" size={128} />
          <View style={styles.thanksBadge}>
            <Ionicons name="sparkles" size={13} color={colors.goldDeep} />
            <Text style={styles.thanksBadgeText}>{name} unlocked</Text>
          </View>
          <Text style={styles.thanksTitle}>Thank you 💛</Text>
          <Text style={styles.thanksBody}>
            {tier === 'family'
              ? 'Your whole family is protected now. Verified responders, unlimited Voice SOS and live tracking are all switched on.'
              : 'Every Premium feature is switched on. Verified responders, unlimited Voice SOS and always-on protection are yours.'}
          </Text>
          <Text style={styles.thanksNote}>
            You're one of ORBII's early members. That means the world to us.
          </Text>
          <View style={{ height: spacing.md }} />
          <Button label="Let's go" onPress={onClose} />
        </View>
      </View>
    </Modal>
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
            {plan ? `${plan.name} · ${formatPrice(plan.price)}/mo` : ''}
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
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#B8895A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  planCardHighlight: {
    borderWidth: 2,
    borderColor: colors.peachDeep,
    shadowColor: colors.peachDeep,
    shadowOpacity: 0.22,
    shadowRadius: 24,
  },
  popularPill: {
    position: 'absolute',
    top: -11,
    right: spacing.lg,
    backgroundColor: colors.peachDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  popularPillMuted: {
    backgroundColor: colors.sageSoft,
  },
  popularPillText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 10,
    color: colors.textInverse,
    letterSpacing: 0.6,
  },
  popularPillTextMuted: {
    color: colors.sageDeep,
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
  includedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.creamDeep,
  },
  includedBtnText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14.5,
    color: colors.textMuted,
  },
  thanksBackdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  thanksCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.cream,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    alignItems: 'center',
    ...shadows.sheet,
  },
  thanksBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  thanksBadgeText: {
    ...typography.label,
    color: colors.goldDeep,
  },
  thanksTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  thanksBody: {
    ...typography.body,
    fontSize: 14.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  thanksNote: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.peachDeep,
    textAlign: 'center',
    marginTop: spacing.sm,
    fontFamily: 'Poppins_600SemiBold',
  },
  valueLine: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  valueStrong: { fontFamily: 'Poppins_700Bold', color: colors.brandDeep },
  trustStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    ...shadows.card,
  },
  trustItem: { alignItems: 'center', gap: 7 },
  trustIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trustLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 11.5,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 15,
  },
  socialProof: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  socialText: { flex: 1, ...typography.caption, fontSize: 11.5, color: colors.textSecondary, lineHeight: 16 },
  couponCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  giftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  giftHint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  couponLabel: {
    ...typography.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
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
