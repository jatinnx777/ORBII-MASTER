import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';

// Shown in place of a screen's content when a free user opens a Plus-only
// feature. Explains what it unlocks and sends them to the plans page (where the
// checkout + coupon flow lives). Keep it warm, not punishing.
export function PremiumLock({
  feature,
  blurb,
  icon = 'sparkles',
}: {
  feature: string;
  blurb: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const navigation = useNavigation();
  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={34} color={colors.goldDeep} />
          </View>
          <View style={styles.plusPill}>
            <Ionicons name="sparkles" size={12} color={colors.goldDeep} />
            <Text style={styles.plusPillText}>ORBII PLUS</Text>
          </View>
          <Text style={styles.title}>{feature} is a Plus feature</Text>
          <Text style={styles.blurb}>{blurb}</Text>

          <Pressable
            onPress={() => navigation.navigate('PremiumUpgrade' as never)}
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          >
            <Ionicons name="sparkles" size={18} color={colors.textPrimary} />
            <Text style={styles.ctaText}>Unlock with ORBII Plus</Text>
          </Pressable>
          <Text style={styles.foot}>Have a coupon? You can redeem it at checkout.</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  plusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: spacing.md,
  },
  plusPillText: { fontFamily: fontFamilies.poppinsBold, fontSize: 10.5, letterSpacing: 0.8, color: colors.goldDeep },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary, textAlign: 'center' },
  blurb: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 320,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    paddingVertical: 15,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.xl,
    alignSelf: 'stretch',
    ...shadows.card,
  },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  foot: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textMuted, marginTop: spacing.md },
  pressed: { opacity: 0.9 },
});
