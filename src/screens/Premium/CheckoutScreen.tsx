import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { store } from '@/redux/store';
import { premiumTierResolved } from '@/redux/slices/userSlice';
import { resolvePremiumTier } from '@/services/razorpay';
import { redeemCoupon, redeemReasonMessage } from '@/services/coupons';

// Checkout for ORBII Plus. Card billing (Play Billing) is not wired yet, so the
// live path here is the COUPON: enter a code, and a valid one unlocks Plus for a
// month. The coupon field lives HERE, at checkout, not on the plans page.
const PLUS_INCLUDES = [
  'Unlimited verified-helper dispatches',
  'Disaster mode (offline helplines + SMS)',
  'The ORBII Community',
  'Circle safe zones (geofencing)',
  'Offline helper alert',
];

export function CheckoutScreen() {
  const navigation = useNavigation();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    const res = await redeemCoupon(code);
    if (res.ok) {
      // Pull the now-written entitlement and flip premium on across the app.
      const tier = await resolvePremiumTier();
      if (tier) store.dispatch(premiumTierResolved(tier));
      setBusy(false);
      appAlert(
        'ORBII Plus unlocked',
        'Your coupon worked. Plus is active for a month, everything is unlocked.',
      );
      navigation.goBack();
    } else {
      setBusy(false);
      appAlert("Couldn't apply coupon", redeemReasonMessage(res.reason));
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Checkout</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Plan summary */}
          <View style={styles.planCard}>
            <View style={styles.planHead}>
              <View style={styles.planIcon}>
                <Ionicons name="sparkles" size={18} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.planName}>ORBII Plus</Text>
                <Text style={styles.planPrice}>₹99 / month</Text>
              </View>
            </View>
            {PLUS_INCLUDES.map((f) => (
              <View key={f} style={styles.incRow}>
                <Ionicons name="checkmark-circle" size={17} color={colors.sageDeep} />
                <Text style={styles.incText}>{f}</Text>
              </View>
            ))}
          </View>

          {/* Coupon */}
          <Text style={styles.sectionLabel}>HAVE A COUPON?</Text>
          <View style={styles.couponCard}>
            <TextInput
              value={code}
              onChangeText={(v) => setCode(v.toUpperCase())}
              placeholder="Enter code"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.couponInput}
            />
            <Pressable
              onPress={apply}
              disabled={busy || !code.trim()}
              style={({ pressed }) => [
                styles.applyBtn,
                (busy || !code.trim() || pressed) && styles.applyDim,
              ]}
            >
              <Text style={styles.applyText}>{busy ? '…' : 'Apply'}</Text>
            </Pressable>
          </View>

          <View style={styles.note}>
            <Ionicons name="card-outline" size={16} color={colors.brandDeep} />
            <Text style={styles.noteText}>
              Card and UPI billing is coming soon. For now, a coupon unlocks Plus for a month.
            </Text>
          </View>
        </ScrollView>
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
    paddingBottom: spacing.xs,
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
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  scroll: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },

  planCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.card },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  planIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.goldSoft, alignItems: 'center', justifyContent: 'center' },
  planName: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary },
  planPrice: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textSecondary },
  incRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  incText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textPrimary },

  sectionLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1, color: colors.textMuted, marginTop: spacing.sm },
  couponCard: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  couponInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    letterSpacing: 1,
    color: colors.textPrimary,
    ...shadows.icon,
  },
  applyBtn: {
    backgroundColor: colors.textPrimary,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
  },
  applyDim: { opacity: 0.5 },
  applyText: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textInverse },

  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    backgroundColor: colors.brandSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.brandDeep, lineHeight: 18 },
});
