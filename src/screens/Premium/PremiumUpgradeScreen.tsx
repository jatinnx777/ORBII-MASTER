import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

// New model: real help (a verified responder dispatched to you) is FREE for
// everyone, capped at 2 dispatches a month on the free plan. ORBII Plus lifts the
// cap and adds the offline extras. Helpers are paid in ORBII coins, never direct
// cash from the user.
//
// Paywall design follows the HONEST patterns that actually lift conversion:
// safety stays visibly free, we say exactly when (and whether) you'll be charged,
// and cancelling is one tap. No fake urgency, no hidden cost, a safety app has
// to be the last place anyone feels tricked.

type Feature = { icon: React.ComponentProps<typeof Ionicons>['name']; text: string };

const FREE: Feature[] = [
  { icon: 'mic', text: 'Hands-free Voice SOS, unlimited' },
  { icon: 'people', text: 'Alert your circle and nearby ORBII members' },
  { icon: 'call', text: 'One-tap 112' },
  { icon: 'shield-checkmark', text: '2 verified-helper dispatches every month' },
  { icon: 'wifi', text: 'Offline SOS: SMS lifeline and Bluetooth relay' },
  { icon: 'chatbubbles', text: 'The ORBII Community' },
];

const PLUS: Feature[] = [
  { icon: 'infinite', text: 'Unlimited verified-helper dispatches' },
  { icon: 'navigate', text: 'Offline helper alert, reach nearby helpers with no internet' },
  { icon: 'flash', text: 'Priority helper matching and live ETA' },
];

type PlanKey = 'weekly' | 'monthly';
const PLANS: { key: PlanKey; price: string; per: string; tag: string }[] = [
  { key: 'weekly', price: '₹49', per: '/week', tag: 'FLEXIBLE' },
  { key: 'monthly', price: '₹149', per: '/month', tag: 'BEST VALUE' },
];

export function PremiumUpgradeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<AppStackParamList>>();
  const [plan, setPlan] = React.useState<PlanKey>('monthly');
  const selected = PLANS.find((p) => p.key === plan) ?? PLANS[1];

  React.useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[colors.brandSoft, colors.cream]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.glow}
      />
      <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <View style={styles.heroOrb}>
          <Ionicons name="infinite" size={34} color={colors.textInverse} />
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>ORBII PLUS</Text>
        </View>
        <Text style={styles.title}>No limits when it matters most</Text>
        <Text style={styles.subtitle}>
          A verified helper actually reaching you is free for everyone. Plus removes
          the monthly cap and adds the offline extras.
        </Text>
      </View>

      {/* Safety-is-free reassurance: the most important promise, up top. */}
      <View style={styles.freeBanner}>
        <Ionicons name="heart" size={18} color={colors.sageDeep} />
        <Text style={styles.freeBannerText}>
          Everything that could save your life is free, forever. Plus is only for
          extra reach, never for safety itself.
        </Text>
      </View>

      {/* Free */}
      <View style={styles.card}>
        <View style={styles.planHead}>
          <Text style={styles.planName}>Free</Text>
          <Text style={styles.planPrice}>₹0 forever</Text>
        </View>
        {FREE.map((f) => (
          <View key={f.text} style={styles.row}>
            <Ionicons name={f.icon} size={18} color={colors.sageDeep} style={styles.rowIcon} />
            <Text style={styles.rowText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* Plus */}
      <View style={[styles.card, styles.plusCard]}>
        <View style={styles.planHead}>
          <View style={styles.plusNameWrap}>
            <Text style={styles.planName}>ORBII Plus</Text>
            <View style={styles.bestBadge}><Text style={styles.bestText}>NO LIMITS</Text></View>
          </View>
        </View>
        <Text style={styles.plusEverything}>Everything in Free, plus</Text>
        {PLUS.map((f) => (
          <View key={f.text} style={styles.row}>
            <Ionicons name={f.icon} size={18} color={colors.brandDeep} style={styles.rowIcon} />
            <Text style={styles.rowText}>{f.text}</Text>
          </View>
        ))}

        {/* Plan picker: weekly is the low-commitment way in, monthly is the value. */}
        <View style={styles.plans}>
          {PLANS.map((pl) => {
            const on = plan === pl.key;
            return (
              <Pressable
                key={pl.key}
                onPress={() => setPlan(pl.key)}
                style={[styles.planOpt, on && styles.planOptOn]}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <View style={styles.planOptTop}>
                  <View style={[styles.radio, on && styles.radioOn]}>
                    {on ? <Ionicons name="checkmark" size={11} color={colors.textInverse} /> : null}
                  </View>
                  <View style={[styles.planTag, on && styles.planTagOn]}>
                    <Text style={[styles.planTagText, on && styles.planTagTextOn]}>{pl.tag}</Text>
                  </View>
                </View>
                <View style={styles.priceWrap}>
                  <Text style={styles.plusPrice}>{pl.price}</Text>
                  <Text style={styles.plusPer}>{pl.per}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.trialRow}>
          <Ionicons name="gift-outline" size={15} color={colors.brandDeep} />
          <Text style={styles.trialText}>
            Start with 7 days free, then {selected.price}{selected.per}.
          </Text>
        </View>
      </View>

      {/* Honest billing: exactly what happens to their money, and how to stop it. */}
      <View style={styles.billing}>
        <Ionicons name="pricetag-outline" size={18} color={colors.brandDeep} />
        <Text style={styles.billingText}>
          You are not charged today. Plus is free during early access. When paid
          plans begin, your 7 days free start first, we remind you 2 days before it
          ends, and you can cancel in one tap, anytime. No surprise charges, ever.
        </Text>
      </View>

      {/* How helpers are paid, honestly. */}
      <View style={styles.coinsCard}>
        <Ionicons name="server-outline" size={18} color={colors.goldDeep} />
        <Text style={styles.coinsText}>
          You never hand anyone cash. Every verified helper who reaches you earns
          ORBII coins they collect and later redeem. ORBII handles all of it, so
          help is never a money-for-rescue deal on the street.
        </Text>
      </View>

      <Button label="Start 7-day free trial" onPress={() => navigation.navigate('Checkout')} />
      <Text style={styles.cancelNote}>Free during early access. Cancel anytime.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.cream },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 320 },
  root: { flex: 1, backgroundColor: 'transparent' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  heroOrb: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  badge: { backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
  badgeText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1, color: colors.brandDeep },
  title: { ...typography.h1, fontSize: 24, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xs },
  subtitle: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 330 },

  freeBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  freeBannerText: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.sageDeep, lineHeight: 18 },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  plusCard: { borderWidth: 2, borderColor: colors.brand },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  plusNameWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planName: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  planPrice: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },
  priceWrap: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  plusPrice: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.brandDeep },
  plusPer: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
  bestBadge: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  bestText: { fontFamily: fontFamilies.poppinsBold, fontSize: 9, letterSpacing: 0.6, color: colors.textInverse },
  plusEverything: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted, marginBottom: 2 },

  plans: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  planOpt: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.cream,
    padding: spacing.md,
    gap: 8,
  },
  planOptOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  planOptTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  planTag: { backgroundColor: colors.creamDeep, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  planTagOn: { backgroundColor: colors.brand },
  planTagText: { fontFamily: fontFamilies.poppinsBold, fontSize: 8.5, letterSpacing: 0.5, color: colors.textMuted },
  planTagTextOn: { color: colors.textInverse },
  trialRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  trialText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.brandDeep },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowIcon: { marginTop: 1 },
  rowText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14.5, color: colors.textPrimary, lineHeight: 20 },

  billing: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: spacing.md },
  billingText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.brandDeep, lineHeight: 19 },

  coinsCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: radius.lg, padding: spacing.md },
  coinsText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.goldDeep, lineHeight: 19 },

  cancelNote: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: -spacing.sm },
});
