import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { supabase } from '@/services/supabase';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import {
  guardianLevel,
  loadHelperProfileSafe,
  type GuardianLevel,
  type HelperProfile,
} from '@/services/helper-profile';
import {
  isHelperModeRunning,
  startHelperMode,
  stopHelperMode,
} from '@/services/helper-mode';
import { loadHelperStats, type HelperStats } from '@/services/helper-economy';
import { getCoinWallet, type CoinWallet } from '@/services/coins';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

const LEVEL_TINT: Record<GuardianLevel, { bg: string; fg: string }> = {
  Bronze: { bg: '#F3E7D6', fg: '#A9743B' },
  Silver: { bg: '#E9ECEF', fg: '#6B7280' },
  Gold: { bg: colors.goldSoft, fg: colors.goldDeep },
  Elite: { bg: colors.lavenderSoft, fg: colors.lavenderDeep },
};

// Missions = the responder dashboard. A permission-gated tab (only approved
// responders reach it). A professional responder console — online/offline,
// trust, recognition. Dispatch/mission logic comes in a later milestone.
export function MissionsScreen() {
  const navigation = useNavigation<Nav>();
  const profile = useAppSelector((s) => s.user.profile);
  const [hp, setHp] = useState<HelperProfile | null>(null);
  const [stats, setStats] = useState<HelperStats | null>(null);
  const [wallet, setWallet] = useState<CoinWallet | null>(null);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(isHelperModeRunning());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!profile?.uid) return;
    const [p, s, w] = await Promise.all([
      loadHelperProfileSafe(profile.uid),
      loadHelperStats(),
      getCoinWallet(),
    ]);
    setHp(p);
    setStats(s);
    setWallet(w);
    setLoading(false);
  }, [profile?.uid]);

  // Live dashboard: it refreshes the moment the server changes the helper's
  // row or wallet (Supabase realtime), when the app returns to the foreground,
  // and on a slow safety poll — so trust, earnings, level and missions update
  // without ever closing and reopening the app.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const run = () => {
        if (alive) void refresh();
      };
      run();
      setOnline(isHelperModeRunning());

      const uid = profile?.uid;
      const channel = uid
        ? supabase
            .channel(`missions:${uid}`)
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'helper_profiles', filter: `user_id=eq.${uid}` },
              run,
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'payout_requests', filter: `user_id=eq.${uid}` },
              run,
            )
            .subscribe()
        : null;

      const poll = setInterval(run, 20000);
      const appSub = AppState.addEventListener('change', (st) => {
        if (st === 'active') run();
      });

      return () => {
        alive = false;
        clearInterval(poll);
        appSub.remove();
        if (channel) supabase.removeChannel(channel);
      };
    }, [profile?.uid, refresh]),
  );

  // "Can go online" = admin has approved this responder (verification_status =
  // 'verified'). We deliberately do NOT require isFullyVerified() here — that
  // also needs training_done, which admin approval doesn't set, so it would
  // trap approved helpers on the verification screen forever.
  const verified = hp?.verificationStatus === 'verified';
  const level = hp ? guardianLevel(hp) : 'Bronze';
  const tint = LEVEL_TINT[level];

  const toggleOnline = async (next: boolean) => {
    if (busy) return;
    if (next && hp && !verified) {
      navigation.navigate('ResponderVerification');
      return;
    }
    setBusy(true);
    try {
      if (next) await startHelperMode();
      else await stopHelperMode();
      setOnline(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>RESPONDER</Text>
            <Text style={styles.title}>Missions</Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('ResponderRecognition')}
            style={styles.iconBtn}
            hitSlop={8}
          >
            <Ionicons name="ribbon-outline" size={20} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.sage} />
            </View>
          ) : (
            <>
              {!verified ? (
                <Pressable
                  style={styles.verifyBanner}
                  onPress={() => navigation.navigate('ResponderVerification')}
                >
                  <Ionicons name="shield-checkmark" size={20} color={colors.coralDeep} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.verifyTitle}>Finish verification to go online</Text>
                    <Text style={styles.verifyBody}>Aadhaar, PAN, face match + training.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.coralDeep} />
                </Pressable>
              ) : null}

              {/* availability — the centerpiece */}
              <View style={[styles.statusCard, online && styles.statusCardOn]}>
                <View style={styles.statusRow}>
                  <View>
                    <Text style={[styles.statusLabel, online && { color: colors.sageDeep }]}>
                      {online ? "You're online" : "You're offline"}
                    </Text>
                    <Text style={styles.statusSub}>
                      {online
                        ? 'Available to respond to emergencies near you.'
                        : 'Go online to be available for nearby emergencies.'}
                    </Text>
                  </View>
                  <Switch
                    value={online}
                    onValueChange={toggleOnline}
                    disabled={busy}
                    trackColor={{ false: colors.border, true: colors.sageSoft }}
                    thumbColor={online ? colors.sage : colors.surface}
                  />
                </View>
                {online ? (
                  <View style={styles.livePill}>
                    <View style={styles.liveDot} />
                    <Text style={styles.liveText}>Live · sharing your location with ORBII</Text>
                  </View>
                ) : null}
              </View>

              {/* active mission placeholder (dispatch comes later) */}
              <View style={styles.missionCard}>
                <Ionicons name="navigate-circle-outline" size={22} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.missionTitle}>No active mission</Text>
                  <Text style={styles.missionBody}>
                    {online
                      ? "You'll be notified the moment someone nearby needs help."
                      : 'Go online to start receiving missions.'}
                  </Text>
                </View>
              </View>

              <View style={styles.row}>
                <Pressable
                  style={[styles.miniCard, { flex: 1 }]}
                  onPress={() => navigation.navigate('ResponderRecognition')}
                >
                  <View style={[styles.levelBadge, { backgroundColor: tint.bg }]}>
                    <Ionicons name="ribbon" size={16} color={tint.fg} />
                    <Text style={[styles.levelText, { color: tint.fg }]}>{level}</Text>
                  </View>
                  <Text style={styles.miniLabel}>Guardian level</Text>
                </Pressable>
                <View style={[styles.miniCard, { flex: 1 }]}>
                  <Text style={styles.trustNum}>{hp?.trustScore ?? 0}</Text>
                  <Text style={styles.miniLabel}>Trust score</Text>
                </View>
              </View>

              {/* ORBII coins — no money shown here, just coins + the rate */}
              <Pressable
                style={styles.earnCard}
                onPress={() => navigation.navigate('CoinsWallet')}
              >
                <View style={styles.earnHeadRow}>
                  <Text style={styles.earnLabel}>ORBII COINS</Text>
                  <Ionicons name="server" size={18} color={colors.sageDeep} />
                </View>
                <Text style={styles.earnBalance}>
                  {(wallet?.balance ?? 0).toLocaleString()}
                </Text>
                <View style={styles.earnMetaRow}>
                  <Text style={styles.earnMeta}>
                    10 coins = ₹1 · earn 200 per confirmed help
                  </Text>
                  <View style={styles.cashOutBtn}>
                    <Text style={styles.cashOutText}>View coins</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.surface} />
                  </View>
                </View>
              </Pressable>

              <View style={styles.statsCard}>
                <Text style={styles.sectionLabel}>YOUR IMPACT</Text>
                <View style={styles.statsRow}>
                  <Stat value={stats?.helped ?? hp?.lifetimeResponses ?? 0} label="People assisted" />
                  <View style={styles.statDivider} />
                  <Stat value={0} label="Missions today" />
                </View>
              </View>

              <Pressable
                style={styles.recoBtn}
                onPress={() => navigation.navigate('ResponderRecognition')}
              >
                <Ionicons name="trophy" size={18} color={colors.goldDeep} />
                <Text style={styles.recoText}>Badges & recognition</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </Pressable>

              <Text style={styles.footnote}>
                Always reach safely, call police (112), and never put yourself at
                unnecessary risk.
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  brand: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, color: colors.sageDeep, letterSpacing: 1 },
  title: { ...typography.displaySmall, color: colors.textPrimary, fontSize: 26 },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: 110, gap: spacing.md },
  loading: { paddingTop: spacing.xxl, alignItems: 'center' },
  verifyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  verifyTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  verifyBody: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  statusCard: { backgroundColor: colors.surface, borderRadius: radius.xxl, padding: spacing.lg, ...shadows.card },
  statusCardOn: { backgroundColor: colors.sageSoft },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  statusLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textPrimary },
  statusSub: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 2, maxWidth: 220 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sage },
  liveText: { fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.sageDeep },
  missionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  missionTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  missionBody: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 1, lineHeight: 17 },
  row: { flexDirection: 'row', gap: spacing.md },
  miniCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm, ...shadows.card },
  levelBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  levelText: { fontFamily: fontFamilies.poppinsBold, fontSize: 13 },
  trustNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 26, color: colors.sageDeep },
  miniLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  earnCard: {
    backgroundColor: colors.sageSoft,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    gap: 6,
    ...shadows.card,
  },
  earnHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  earnLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.sageDeep },
  earnBalance: { fontFamily: fontFamilies.poppinsBold, fontSize: 34, color: colors.textPrimary, letterSpacing: -0.5 },
  earnMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  earnMeta: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary },
  cashOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.sageDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  cashOutText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.surface },
  statsCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.lg, ...shadows.card },
  sectionLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted, marginBottom: spacing.sm },
  statsRow: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontFamily: fontFamilies.poppinsBold, fontSize: 28, color: colors.textPrimary },
  statLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  statDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider, marginVertical: spacing.sm },
  recoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  recoText: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.goldDeep },
  footnote: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, lineHeight: 17, textAlign: 'center', marginTop: spacing.xs },
});
