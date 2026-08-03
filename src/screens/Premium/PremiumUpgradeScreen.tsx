import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, Mascot } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { trackEvent } from '@/services/analytics';

// New model: real help (a verified responder dispatched to you) is FREE for
// everyone, capped at 2 dispatches a month on the free plan. ORBII Plus lifts the
// cap and adds the offline extras. Helpers are paid in ORBII coins, never direct
// cash from the user. Billing isn't live yet (Play Billing / Razorpay comes
// later), so this screen presents the plans and keeps Plus unlocked for now.

type Feature = { icon: React.ComponentProps<typeof Ionicons>['name']; text: string };

const FREE: Feature[] = [
  { icon: 'mic', text: 'Hands-free Voice SOS, unlimited' },
  { icon: 'people', text: 'Alert your circle + nearby ORBII members' },
  { icon: 'call', text: 'One-tap 112' },
  { icon: 'shield-checkmark', text: '2 verified-helper dispatches every month' },
  { icon: 'wifi', text: 'Offline SOS: SMS lifeline + Bluetooth relay' },
  { icon: 'warning', text: 'Disaster mode + nearby Bluetooth chat' },
  { icon: 'chatbubbles', text: 'The ORBII Community' },
];

const PLUS: Feature[] = [
  { icon: 'infinite', text: 'Unlimited verified-helper dispatches' },
  { icon: 'navigate', text: 'Offline helper alert: reach nearby helpers with no internet' },
  { icon: 'flash', text: 'Priority helper matching + live ETA' },
];

export function PremiumUpgradeScreen() {
  const navigation = useNavigation();

  React.useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Mascot pose="celebrate" size={110} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>PLANS</Text>
        </View>
        <Text style={styles.title}>Real help. For everyone.</Text>
        <Text style={styles.subtitle}>
          Calling a verified helper to actually reach you is free for every ORBII user. Plus is for
          when you want no limits and the offline extras.
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
          <Text style={styles.planPrice}>₹99 / month</Text>
        </View>
        <Text style={styles.plusEverything}>Everything in Free, plus</Text>
        {PLUS.map((f) => (
          <View key={f.text} style={styles.row}>
            <Ionicons name={f.icon} size={18} color={colors.brandDeep} style={styles.rowIcon} />
            <Text style={styles.rowText}>{f.text}</Text>
          </View>
        ))}
      </View>

      {/* How helpers are paid — the ORBII coins story, honestly */}
      <View style={styles.coinsCard}>
        <Ionicons name="server-outline" size={18} color={colors.goldDeep} />
        <Text style={styles.coinsText}>
          You never hand anyone cash. Every verified helper who reaches you earns ORBII coins, a
          reward they collect and later redeem. ORBII handles all of it, so help is never a
          money-for-rescue deal on the street.
        </Text>
      </View>

      <View style={styles.soon}>
        <Ionicons name="pricetag-outline" size={18} color={colors.brandDeep} />
        <Text style={styles.soonText}>
          Early access: Plus is unlocked free right now. When paid billing goes live you'll get
          plenty of notice, and nothing you rely on will suddenly lock.
        </Text>
      </View>

      <Button label="Continue" onPress={() => navigation.goBack()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.lg },

  hero: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.md },
  badge: { backgroundColor: colors.brandSoft, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 5 },
  badgeText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1, color: colors.brandDeep },
  title: { ...typography.h1, fontSize: 24, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.xs },
  subtitle: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 330 },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  plusCard: { borderWidth: 2, borderColor: colors.brand },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  plusNameWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  planName: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  planPrice: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary },
  bestBadge: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 3 },
  bestText: { fontFamily: fontFamilies.poppinsBold, fontSize: 9, letterSpacing: 0.6, color: colors.textInverse },
  plusEverything: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted, marginBottom: 2 },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowIcon: { marginTop: 1 },
  rowText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14.5, color: colors.textPrimary, lineHeight: 20 },

  coinsCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.goldSoft, borderRadius: radius.lg, padding: spacing.md },
  coinsText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.goldDeep, lineHeight: 19 },

  soon: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: spacing.md },
  soonText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.brandDeep, lineHeight: 19 },
});
