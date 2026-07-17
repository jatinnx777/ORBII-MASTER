import React, { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness, READINESS_CAP } from '@/services/readiness';
import { useIsPremium } from '@/services/entitlements';
import {
  isListening,
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// ORBII Home — the dashboard.
//
// Layout follows the founder's design: greeting + notifications, a live safety
// status bar, active alerts, the Plus upsell, a setup/learning hub that removes
// itself once you're done, and four quick actions.
//
// Every number here is REAL. The safety bar and the learning hub both read the
// same live readiness signals (permissions, circle, voice, PIN), so the app can
// never tell her she's 90% safe when she hasn't finished setting up.

function greetingFor(hour: number): string {
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  if (hour < 21) return 'Good evening';
  return 'Good night';
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const profile = useAppSelector((s) => s.user.profile);
  const alerts = useAppSelector((s) => s.community.alerts);
  const isPremium = useIsPremium();
  const { pct, doneCount, total, reload } = useReadiness();

  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>(
    isListening() ? 'listening' : 'idle',
  );
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => subscribeStatus(setVoiceStatus), []);

  // Re-read the live signals every time Home comes forward, so the bar reflects
  // a permission the user just granted (or revoked) elsewhere.
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    reload();
    setRefreshing(false);
  }, [reload]);

  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';
  const greeting = greetingFor(new Date().getHours());
  const voiceOn = voiceStatus === 'listening' || voiceStatus === 'starting';
  const setupDone = pct >= READINESS_CAP;
  const activeAlerts = alerts?.length ?? 0;

  const toggleVoice = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (voiceOn) {
        await stopListening();
        return;
      }
      const res = await startListening();
      if (!res.ok) {
        appAlert(
          "Voice SOS couldn't start",
          res.reason === 'permission-denied'
            ? 'ORBII needs microphone access to hear you call for help.'
            : 'Voice SOS runs on the installed Android app.',
        );
        return;
      }
      trackEvent('voice_sos_enabled', { from: 'home_tile' });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    } finally {
      setBusy(false);
    }
  };

  const barColor = setupDone ? colors.sage : colors.brand;

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 110 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand}
            />
          }
        >
          {/* ── Header: who you are + notifications ── */}
          <View style={styles.header}>
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              style={styles.headerLeft}
              accessibilityRole="button"
              accessibilityLabel="Your profile"
            >
              {profile?.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>
                    {firstName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.greeting}>{greeting},</Text>
                <Text style={styles.name} numberOfLines={1}>
                  {firstName}
                </Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate('Notifications')}
              style={styles.bell}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={21} color={colors.textPrimary} />
              {activeAlerts > 0 ? <View style={styles.bellDot} /> : null}
            </Pressable>
          </View>

          {/* ── Your safety status ── */}
          <Pressable
            onPress={() => navigation.navigate('SafetyReadiness')}
            style={({ pressed }) => [styles.statusCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={`Your safety status, ${pct} percent`}
          >
            <View style={styles.statusTop}>
              <Text style={styles.statusTitle}>Your safety status</Text>
              <Text style={[styles.statusPct, { color: barColor }]}>{pct}% safe</Text>
            </View>
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.max(pct, 4)}%`, backgroundColor: barColor },
                ]}
              />
            </View>
            <Text style={styles.statusHint}>
              {setupDone
                ? "You're fully set up and protected."
                : `${doneCount} of ${total} steps done. Tap to finish.`}
            </Text>
          </Pressable>

          {/* ── The SOS. Big, red, unmissable, and the one thing on this screen
              she must never have to hunt for. ── */}
          <View style={styles.sosWrap}>
            <Pressable
              onPress={() => {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                  () => undefined,
                );
                navigation.navigate('SOSCountdown');
              }}
              style={({ pressed }) => [styles.sosBtn, pressed && { transform: [{ scale: 0.97 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Send SOS alert"
            >
              <Text style={styles.sosText}>SOS</Text>
              <Text style={styles.sosSub}>TAP TO SEND ALERT</Text>
            </Pressable>
          </View>

          {/* ── Safe Journey ── */}
          <View style={styles.journeyCard}>
            <View style={styles.journeyTop}>
              <View style={styles.journeyIcon}>
                <Ionicons name="navigate" size={18} color={colors.brandDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.journeyTitle}>Safe Journey Mode</Text>
                <Text style={styles.journeySub}>
                  Live tracking and route monitoring while you travel.
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => navigation.navigate('SafeJourneyStart')}
              style={({ pressed }) => [styles.journeyBtn, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Start a safe journey"
            >
              <Text style={styles.journeyBtnText}>Start Journey</Text>
            </Pressable>
          </View>

          {/* ── Active alerts ── */}
          <Pressable
            onPress={() => navigation.navigate('CommunityAlerts')}
            style={({ pressed }) => [styles.alertCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Active alerts"
          >
            <View
              style={[
                styles.alertIcon,
                activeAlerts > 0 && { backgroundColor: colors.coralSoft },
              ]}
            >
              <Ionicons
                name={activeAlerts > 0 ? 'alert-circle' : 'shield-checkmark-outline'}
                size={20}
                color={activeAlerts > 0 ? colors.coralDeep : colors.sageDeep}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.alertTitle}>
                {activeAlerts > 0
                  ? `${activeAlerts} active alert${activeAlerts > 1 ? 's' : ''} nearby`
                  : 'No active alerts'}
              </Text>
              <Text style={styles.alertSub}>View all alerts</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          {/* ── Go Pro (hidden once she already has Plus) ── */}
          {!isPremium ? (
            <Pressable
              onPress={() => navigation.navigate('PremiumUpgrade')}
              style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Upgrade to ORBII Plus"
            >
              <View style={styles.proIcon}>
                <Ionicons name="sparkles" size={18} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>Go Pro with ORBII Plus</Text>
                <Text style={styles.proSub}>
                  Verified helpers reach you, not just your circle.
                </Text>
              </View>
              <View style={styles.proBtn}>
                <Text style={styles.proBtnText}>Upgrade</Text>
              </View>
            </Pressable>
          ) : null}

          {/* ── Safety learning hub. Removes itself once setup is complete. ── */}
          {!setupDone ? (
            <Pressable
              onPress={() => navigation.navigate('SafetyReadiness')}
              style={({ pressed }) => [styles.learnCard, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Safety learning hub, ${pct} percent complete`}
            >
              <View style={styles.learnTop}>
                <View style={styles.learnIcon}>
                  <Ionicons name="school-outline" size={18} color={colors.brandDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.learnTitle}>Safety learning hub</Text>
                  <Text style={styles.learnSub}>
                    Learn how ORBII protects you. Disappears once you're done.
                  </Text>
                </View>
                <Text style={styles.learnPct}>{pct}%</Text>
              </View>
              <View style={styles.learnBarTrack}>
                <View style={[styles.learnBarFill, { width: `${Math.max(pct, 4)}%` }]} />
              </View>
            </Pressable>
          ) : null}

          {/* ── Quick actions ── */}
          <View style={styles.grid}>
            <Tile
              icon={voiceOn ? 'mic' : 'mic-outline'}
              label={voiceOn ? 'Voice SOS is on' : 'Activate Voice SOS'}
              hint={voiceOn ? 'Listening for "help, help"' : 'Hands-free emergency'}
              active={voiceOn}
              onPress={toggleVoice}
            />
            <Tile
              icon="navigate-outline"
              label="Location sharing"
              hint="Share your live journey"
              onPress={() => navigation.navigate('SafeJourneyStart')}
            />
            <Tile
              icon="recording-outline"
              label="Record evidence"
              hint="Your saved recordings"
              onPress={() => navigation.navigate('History')}
            />
            <Tile
              icon="people-outline"
              label="Community"
              hint="People helping nearby"
              onPress={() => navigation.navigate('CommunityAlerts')}
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Tile({
  icon,
  label,
  hint,
  active,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  hint: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        active && styles.tileActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.tileIcon, active && styles.tileIconActive]}>
        <Ionicons
          name={icon}
          size={20}
          color={active ? colors.textInverse : colors.brandDeep}
        />
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>
        {label}
      </Text>
      <Text style={styles.tileHint} numberOfLines={2}>
        {hint}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.brandDeep,
  },
  greeting: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 19,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  bell: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  bellDot: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.coral,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },

  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  statusTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  statusPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 15 },
  barTrack: {
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.creamDeep,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 5 },
  statusHint: { ...typography.caption, fontSize: 12, color: colors.textSecondary },

  sosWrap: { alignItems: 'center', paddingVertical: spacing.sm },
  sosBtn: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.coral,
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  sosText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 40,
    color: colors.textInverse,
    letterSpacing: 2,
  },
  sosSub: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 10.5,
    color: colors.textInverse,
    letterSpacing: 1,
    marginTop: 2,
    opacity: 0.95,
  },

  journeyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.card,
  },
  journeyTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  journeyIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  journeyTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  journeySub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  journeyBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 12,
    alignItems: 'center',
  },
  journeyBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textInverse,
  },

  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  alertIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  alertSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },

  proCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.goldSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  proIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  proTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  proSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  proBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  proBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textInverse,
  },

  learnCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  learnTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  learnIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  learnTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  learnSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
  learnPct: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.brandDeep },
  learnBarTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.creamDeep,
    overflow: 'hidden',
  },
  learnBarFill: { height: '100%', borderRadius: 4, backgroundColor: colors.brand },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: 6,
    ...shadows.card,
  },
  tileActive: { backgroundColor: colors.brandSoft },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  tileIconActive: { backgroundColor: colors.brand },
  tileLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  tileHint: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },
});
