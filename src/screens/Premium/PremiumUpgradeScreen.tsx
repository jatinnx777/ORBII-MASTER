import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { premiumUpgraded } from '@/redux/slices/userSlice';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'PremiumUpgrade'>;

const perks = [
  { icon: 'people' as const, text: 'Up to 20 emergency contacts' },
  { icon: 'mic' as const, text: 'Voice-activated SOS detection' },
  { icon: 'videocam' as const, text: 'Auto audio + video recording during SOS' },
  { icon: 'shield-checkmark' as const, text: 'Priority police & helper dispatch' },
  { icon: 'notifications' as const, text: 'Family live location sharing' },
];

type Plan = 'monthly' | 'yearly';

export function PremiumUpgradeScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);
  const [plan, setPlan] = useState<Plan>('yearly');
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  const handleUpgrade = () => {
    setPaying(true);
    // TODO: swap to Razorpay
    //   import { RazorpayCheckout } from 'react-native-razorpay';
    //   const order = await fetch('/api/razorpay/order', { method: 'POST', ... });
    //   RazorpayCheckout.open({ key, order_id, amount, currency, prefill });
    setTimeout(() => {
      setPaying(false);
      trackEvent('premium_purchased', { plan });
      dispatch(premiumUpgraded());
      Alert.alert(
        'Welcome to ORBII Premium',
        'You now have access to all premium features.',
        [{ text: 'Great', onPress: () => navigation.goBack() }],
      );
    }, 900);
  };

  if (isPremium) {
    return (
      <ScreenContainer>
        <View style={styles.heroWrap}>
          <Ionicons name="ribbon" size={64} color={colors.accent} />
          <Text style={styles.heroTitle}>You're on Premium</Text>
          <Text style={styles.heroBody}>
            All premium features are unlocked. Next renewal: 2026-05-18.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.heroWrap}>
          <View style={styles.badge}>
            <Ionicons name="ribbon" size={26} color={colors.accent} />
            <Text style={styles.badgeText}>ORBII PREMIUM</Text>
          </View>
          <Text style={styles.heroTitle}>More protection. More peace of mind.</Text>
          <Text style={styles.heroBody}>
            Everything in Basic, plus voice triggers, auto-recording, and priority dispatch.
          </Text>
        </View>

        <View style={styles.perks}>
          {perks.map((p) => (
            <View key={p.text} style={styles.perkRow}>
              <Ionicons name={p.icon} size={20} color={colors.success} />
              <Text style={styles.perkText}>{p.text}</Text>
            </View>
          ))}
        </View>

        <View style={styles.plans}>
          <PlanCard
            title="Yearly"
            price="₹999"
            subtitle="₹83/mo — save 16%"
            active={plan === 'yearly'}
            onPress={() => setPlan('yearly')}
            badge="Best value"
          />
          <PlanCard
            title="Monthly"
            price="₹99"
            subtitle="Cancel anytime"
            active={plan === 'monthly'}
            onPress={() => setPlan('monthly')}
          />
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={paying ? 'Processing…' : `Subscribe · ${plan === 'yearly' ? '₹999/yr' : '₹99/mo'}`}
          onPress={handleUpgrade}
          loading={paying}
        />
        <Text style={styles.disclaimer}>
          Billed through Razorpay. This is a demo checkout — no card charged.
        </Text>
      </View>
    </ScreenContainer>
  );
}

function PlanCard({
  title,
  price,
  subtitle,
  active,
  onPress,
  badge,
}: {
  title: string;
  price: string;
  subtitle: string;
  active: boolean;
  onPress: () => void;
  badge?: string;
}) {
  return (
    <Card
      style={[
        planStyles.card,
        active && { borderColor: colors.primary, borderWidth: 2 },
      ]}
    >
      <View style={planStyles.row}>
        <View style={{ flex: 1 }}>
          <View style={planStyles.titleRow}>
            <Text style={planStyles.title}>{title}</Text>
            {badge ? (
              <View style={planStyles.badge}>
                <Text style={planStyles.badgeText}>{badge}</Text>
              </View>
            ) : null}
          </View>
          <Text style={planStyles.subtitle}>{subtitle}</Text>
        </View>
        <Text style={planStyles.price}>{price}</Text>
      </View>
      <View style={planStyles.picker}>
        <Button
          label={active ? 'Selected' : 'Select'}
          variant={active ? 'primary' : 'outline'}
          onPress={onPress}
          fullWidth={false}
        />
      </View>
    </Card>
  );
}

const planStyles = StyleSheet.create({
  card: {
    padding: spacing.md,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  price: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.primary,
  },
  picker: { alignItems: 'flex-start' },
  badge: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    ...typography.caption,
    color: colors.dark,
    fontFamily: fontFamilies.poppinsMedium,
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
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  badgeText: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsMedium,
    color: colors.textPrimary,
    letterSpacing: 1,
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
  perks: {
    gap: spacing.sm,
  },
  perkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  perkText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
  },
  plans: {
    gap: spacing.md,
  },
  footer: {
    padding: spacing.lg,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  disclaimer: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
