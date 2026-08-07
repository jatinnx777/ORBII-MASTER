import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useBrandSheet } from '@/components/common';
import {
  formatRupees,
  loadHelperStats,
  loadMyPayouts,
  requestPayout,
  type HelperStats,
  type PayoutMethod,
  type PayoutRow,
} from '@/services/helper-economy';

export function ResponderEarningsScreen() {
  const navigation = useNavigation();
  const sheet = useBrandSheet();
  const [stats, setStats] = useState<HelperStats | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);

  const refresh = useCallback(async () => {
    const [s, p] = await Promise.all([loadHelperStats(), loadMyPayouts()]);
    setStats(s);
    setPayouts(p);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Earnings</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={{ paddingTop: 60 }}>
              <ActivityIndicator color={colors.sage} />
            </View>
          ) : (
            <>
              <View style={styles.heroCard}>
                <Text style={styles.heroLabel}>WALLET BALANCE</Text>
                <Text style={styles.heroBalance}>{formatRupees(stats?.balancePaise ?? 0)}</Text>
                <Pressable
                  style={({ pressed }) => [styles.cashBtn, pressed && { opacity: 0.9 }]}
                  onPress={() => {
                    if ((stats?.balancePaise ?? 0) < 10000) {
                      sheet.notify({
                        title: 'Minimum ₹100 to cash out',
                        body: 'Keep helping to grow your balance to at least ₹100.',
                        tone: 'warning',
                      });
                      return;
                    }
                    setModal(true);
                  }}
                >
                  <Ionicons name="cash-outline" size={18} color={colors.surface} />
                  <Text style={styles.cashBtnText}>Cash out</Text>
                </Pressable>
              </View>

              <View style={styles.statRow}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{stats?.helped ?? 0}</Text>
                  <Text style={styles.statLabel}>People helped</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>{formatRupees(stats?.earnedPaise ?? 0)}</Text>
                  <Text style={styles.statLabel}>Earned in total</Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>PAYOUT HISTORY</Text>
              {payouts.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Ionicons name="receipt-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.emptyText}>No payouts yet.</Text>
                </View>
              ) : (
                payouts.map((p) => (
                  <View key={p.id} style={styles.payoutRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.payoutAmount}>{formatRupees(p.amountPaise)}</Text>
                      <Text style={styles.payoutMeta}>
                        {p.method.toUpperCase()} · {new Date(p.createdAt).toLocaleDateString('en-IN')}
                      </Text>
                    </View>
                    <View style={[styles.badge, badgeTint(p.status)]}>
                      <Text style={[styles.badgeText, { color: badgeTint(p.status).color }]}>
                        {p.status}
                      </Text>
                    </View>
                  </View>
                ))
              )}

              <Text style={styles.footnote}>
                Payouts are reviewed and sent by the ORBII team, usually within a few
                working days. Make sure your UPI ID or bank details are correct.
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <CashOutModal
        visible={modal}
        maxPaise={stats?.balancePaise ?? 0}
        onClose={() => setModal(false)}
        onDone={async () => {
          setModal(false);
          await refresh();
          sheet.notify({
            title: 'Payout requested',
            body: 'We’ll send your money and mark it paid here once done.',
            tone: 'success',
          });
        }}
      />
    </View>
  );
}

function badgeTint(status: PayoutRow['status']) {
  if (status === 'paid') return { backgroundColor: colors.sageSoft, color: colors.sageDeep };
  if (status === 'rejected') return { backgroundColor: colors.coralSoft, color: colors.coralDeep };
  return { backgroundColor: colors.goldSoft, color: colors.goldDeep };
}

function CashOutModal({
  visible,
  maxPaise,
  onClose,
  onDone,
}: {
  visible: boolean;
  maxPaise: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PayoutMethod>('upi');
  const [upi, setUpi] = useState('');
  const [accName, setAccName] = useState('');
  const [accNum, setAccNum] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const rupees = parseFloat(amount);
    if (isNaN(rupees) || rupees < 100) {
      setError('Enter an amount of at least ₹100.');
      return;
    }
    const paise = Math.round(rupees * 100);
    if (paise > maxPaise) {
      setError('Amount is more than your balance.');
      return;
    }
    setSubmitting(true);
    const res = await requestPayout({
      amountPaise: paise,
      method,
      upiId: upi.trim(),
      accountName: accName.trim(),
      accountNumber: accNum.trim(),
      ifsc: ifsc.trim().toUpperCase(),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setAmount('');
    setUpi('');
    setAccNum('');
    setIfsc('');
    setAccName('');
    onDone();
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Cash out</Text>
          <Text style={styles.sheetSub}>Available: {formatRupees(maxPaise)}</Text>

          <Text style={styles.fieldLabel}>Amount (₹)</Text>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            placeholder="100"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />

          <View style={styles.methodRow}>
            {(['upi', 'bank'] as PayoutMethod[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                style={[styles.methodBtn, method === m && styles.methodBtnOn]}
              >
                <Text style={[styles.methodText, method === m && styles.methodTextOn]}>
                  {m === 'upi' ? 'UPI' : 'Bank account'}
                </Text>
              </Pressable>
            ))}
          </View>

          {method === 'upi' ? (
            <>
              <Text style={styles.fieldLabel}>UPI ID</Text>
              <TextInput
                value={upi}
                onChangeText={setUpi}
                autoCapitalize="none"
                placeholder="yourname@upi"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
            </>
          ) : (
            <>
              <Text style={styles.fieldLabel}>Account holder name</Text>
              <TextInput value={accName} onChangeText={setAccName} placeholder="Full name"
                placeholderTextColor={colors.textMuted} style={styles.input} />
              <Text style={styles.fieldLabel}>Account number</Text>
              <TextInput value={accNum} onChangeText={setAccNum} keyboardType="numeric"
                placeholder="Account number" placeholderTextColor={colors.textMuted} style={styles.input} />
              <Text style={styles.fieldLabel}>IFSC</Text>
              <TextInput value={ifsc} onChangeText={setIfsc} autoCapitalize="characters"
                placeholder="IFSC code" placeholderTextColor={colors.textMuted} style={styles.input} />
            </>
          )}

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <Pressable
            style={({ pressed }) => [styles.submitBtn, (submitting) && { opacity: 0.6 }, pressed && { opacity: 0.9 }]}
            onPress={submit}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color={colors.surface} size="small" />
            ) : (
              <Text style={styles.submitText}>Request payout</Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
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
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center', ...shadows.icon,
  },
  title: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  heroCard: {
    backgroundColor: colors.sageSoft,
    borderRadius: radius.xxl,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  heroLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1.4, color: colors.sageDeep, textTransform: 'uppercase' },
  heroBalance: { fontFamily: fontFamilies.poppinsBold, fontSize: 46, color: colors.sageDeep, letterSpacing: -1.2 },
  cashBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: colors.sageDeep, paddingHorizontal: spacing.xl, paddingVertical: spacing.md,
    borderRadius: radius.pill, marginTop: spacing.xs,
  },
  cashBtnText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.surface },
  statRow: { flexDirection: 'row', gap: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center', gap: 2, ...shadows.card },
  statValue: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  sectionLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted, marginTop: spacing.sm },
  emptyCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, alignItems: 'center', gap: 6, ...shadows.card },
  emptyText: { ...typography.caption, fontSize: 13, color: colors.textMuted },
  payoutRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, ...shadows.card,
  },
  payoutAmount: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  payoutMeta: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, textTransform: 'capitalize' },
  footnote: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, lineHeight: 17, marginTop: spacing.sm },
  // modal
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.cream, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.lg, paddingBottom: spacing.xl },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, alignSelf: 'center', marginBottom: spacing.md },
  sheetTitle: { ...typography.h2, color: colors.textPrimary },
  sheetSub: { ...typography.caption, fontSize: 13, color: colors.textSecondary, marginBottom: spacing.sm },
  fieldLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary, marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 13,
    fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textPrimary, ...shadows.icon,
  },
  methodRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  methodBtn: { flex: 1, paddingVertical: 11, borderRadius: radius.md, backgroundColor: colors.surface, alignItems: 'center', borderWidth: 1.5, borderColor: colors.border },
  methodBtnOn: { backgroundColor: colors.sageSoft, borderColor: colors.sage },
  methodText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textSecondary },
  methodTextOn: { color: colors.sageDeep },
  errorText: { ...typography.caption, fontSize: 12.5, color: colors.coralDeep, marginTop: spacing.md },
  submitBtn: {
    backgroundColor: colors.sageDeep, borderRadius: radius.xl, paddingVertical: spacing.md,
    alignItems: 'center', justifyContent: 'center', marginTop: spacing.lg, ...shadows.card,
  },
  submitText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.surface },
});
