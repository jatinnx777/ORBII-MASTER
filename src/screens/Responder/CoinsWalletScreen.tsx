import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenContainer, Button, appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import {
  getCoinWallet,
  requestCoinRedemption,
  coinReasonLabel,
  type CoinWallet,
} from '@/services/coins';

export function CoinsWalletScreen() {
  const navigation = useNavigation();
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setWallet(await getCoinWallet());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const redeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    const res = await requestCoinRedemption();
    setRedeeming(false);
    if (res.ok) {
      appAlert(
        'Redemption requested',
        `You cashed out ${res.coins} coins (₹${res.rupees}). ORBII will process the payout to you. It'll show as pending here.`,
      );
      void load();
    } else if (res.reason === 'below_min') {
      appAlert('Not enough yet', 'You can redeem once your vault reaches 500 coins (₹50).');
    } else {
      appAlert('Could not redeem', 'Please try again in a moment.');
    }
  };

  const balance = wallet?.balance ?? 0;
  const rupees = wallet?.rupees ?? 0;
  const progress = Math.min(1, balance / 500);

  return (
    <ScreenContainer padded={false} scroll={false} edges={['top', 'left', 'right']}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Ionicons
            name="chevron-back"
            size={22}
            color={colors.textPrimary}
            onPress={() => navigation.goBack()}
            style={styles.back}
          />
          <Text style={styles.headerTitle}>ORBII coins</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Balance card */}
          <View style={styles.balanceCard}>
            <Ionicons name="server" size={30} color={colors.goldDeep} />
            <Text style={styles.balanceCoins}>{balance.toLocaleString()} coins</Text>
            <Text style={styles.balanceRupees}>≈ ₹{rupees.toFixed(2)}</Text>
            <Text style={styles.rate}>10 coins = ₹1 · you earn 200 coins per confirmed help</Text>
          </View>

          {/* Redeem progress */}
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Redeem at 500 coins (₹50)</Text>
            <View style={styles.track}>
              <LinearGradient
                colors={[colors.gold, colors.peach]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.fill, { width: `${progress * 100}%` }]}
              />
            </View>
            <Text style={styles.progressText}>
              {balance >= 500
                ? "You've reached the minimum. Cash out any time."
                : `${500 - balance} more coins to your first redemption.`}
            </Text>
            <Button
              label={redeeming ? 'Requesting…' : 'Redeem for cash'}
              onPress={redeem}
              disabled={!wallet?.canRedeem || redeeming}
            />
          </View>

          {/* History */}
          <Text style={styles.sectionLabel}>ACTIVITY</Text>
          {loading ? (
            <Text style={styles.muted}>Loading…</Text>
          ) : wallet && wallet.transactions.length > 0 ? (
            <View style={styles.card}>
              {wallet.transactions.map((t, i) => (
                <View key={i} style={[styles.txRow, i > 0 && styles.txDivider]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txLabel}>{coinReasonLabel(t.reason)}</Text>
                    <Text style={styles.txDate}>{new Date(t.created_at).toLocaleDateString()}</Text>
                  </View>
                  <Text style={[styles.txDelta, { color: t.delta >= 0 ? colors.sageDeep : colors.coralDeep }]}>
                    {t.delta >= 0 ? '+' : ''}
                    {t.delta}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.muted}>No coins yet. Confirmed helps will show up here.</Text>
          )}

          <Text style={styles.foot}>
            You're paid in coins, never cash on the street. Coins are earned only when a person you
            reached confirms your arrival, so they can't be faked.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  back: { width: 40, height: 40, textAlign: 'center', textAlignVertical: 'center' },
  headerTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  balanceCard: {
    alignItems: 'center',
    backgroundColor: colors.goldSoft,
    borderRadius: radius.xxl,
    paddingVertical: spacing.xl,
    gap: 4,
    marginTop: spacing.xs,
  },
  balanceCoins: { fontFamily: fontFamilies.poppinsBold, fontSize: 28, color: colors.textPrimary, marginTop: spacing.sm },
  balanceRupees: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.goldDeep },
  rate: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textSecondary, marginTop: 6, textAlign: 'center', maxWidth: 300 },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.md, ...shadows.card },
  cardLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5, backgroundColor: colors.goldDeep },
  progressText: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textSecondary },

  sectionLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1, color: colors.textMuted, marginTop: spacing.sm },
  muted: { fontFamily: fontFamilies.interMedium, fontSize: 13.5, color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.md },

  txRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  txDivider: { borderTopWidth: 1, borderTopColor: colors.divider },
  txLabel: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textPrimary },
  txDate: { fontFamily: fontFamilies.interRegular, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  txDelta: { fontFamily: fontFamilies.poppinsBold, fontSize: 15 },

  foot: { fontFamily: fontFamilies.interMedium, fontSize: 12, lineHeight: 18, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
