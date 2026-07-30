import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Button, Mascot } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { trackEvent } from '@/services/analytics';

// During early access every ORBII feature is unlocked and free. Paid plans will
// arrive later through Google Play Billing (the only Play-compliant way to sell
// in-app subscriptions). So this screen no longer takes payments — it welcomes
// the user to the full app and previews what paid plans will look like.

const UNLOCKED = [
  'Verified responders dispatched to you nearby',
  'Unlimited hands-free Voice SOS',
  'Always-on background voice monitoring',
  'The ORBII Community — anonymous and moderated',
  'Family Circles with live tracking during an SOS',
  'Priority helper matching and live ETA',
];

export function PremiumUpgradeScreen() {
  const navigation = useNavigation();

  React.useEffect(() => {
    trackEvent('premium_viewed');
  }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <Mascot pose="celebrate" size={120} />
        <View style={styles.badge}>
          <Text style={styles.badgeText}>EARLY ACCESS</Text>
        </View>
        <Text style={styles.title}>Everything's unlocked. Free.</Text>
        <Text style={styles.subtitle}>
          While ORBII is in early access, every Plus feature is on the house. No payment, no catch, we want you protected and helping us make it great.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>What you get right now</Text>
        {UNLOCKED.map((f) => (
          <View key={f} style={styles.row}>
            <Ionicons name="checkmark-circle" size={20} color={colors.brand} />
            <Text style={styles.rowText}>{f}</Text>
          </View>
        ))}
      </View>

      <View style={styles.soon}>
        <Ionicons name="pricetag-outline" size={18} color={colors.brandDeep} />
        <Text style={styles.soonText}>
          Paid plans (ORBII Plus and Family) are coming soon. When they launch you will get plenty of notice, nothing you rely on will suddenly lock.
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
  subtitle: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', lineHeight: 21, maxWidth: 320 },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  cardLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 13, color: colors.textPrimary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rowText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14.5, color: colors.textPrimary, lineHeight: 20 },

  soon: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', backgroundColor: colors.brandSoft, borderRadius: radius.lg, padding: spacing.md },
  soonText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.brandDeep, lineHeight: 19 },
});
