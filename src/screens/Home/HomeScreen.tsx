import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { useReadiness } from '@/services/readiness';
import { subscribePresence, type PresencePeer } from '@/services/community';
import {
  isListening,
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import {
  startBackgroundVoice,
  stopBackgroundVoice,
  saveBgVoiceState,
  requestBatteryExemption,
} from '@/services/background-voice';
import { shareMyLocation } from '@/services/location-share';
import { comingSoon } from '@/services/coming-soon';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

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
  const tier = profile?.premiumTier ?? null;
  const { pct } = useReadiness();

  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>(
    isListening() ? 'listening' : 'idle',
  );
  const [peers, setPeers] = useState<PresencePeer[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => subscribeStatus(setVoiceStatus), []);
  useEffect(() => subscribePresence(setPeers), []);
  useFocusEffect(useCallback(() => undefined, []));

  const voiceOn = voiceStatus === 'listening' || voiceStatus === 'starting';

  const circleUids = useMemo(
    () => new Set((profile?.friends ?? []).map((f) => f.uid).filter((u): u is string => !!u)),
    [profile?.friends],
  );

  // Circle members: friends, tagged online if we can see them in presence.
  const members = useMemo(() => {
    const online = new Map<string, PresencePeer>();
    for (const p of peers) if (circleUids.has(p.userId)) online.set(p.userId, p);
    return (profile?.friends ?? []).map((f) => {
      const live = f.uid ? online.get(f.uid) : undefined;
      return {
        uid: f.uid ?? f.username,
        name: (live?.name || f.name || f.username || 'Member') as string,
        photoUri: live?.photoUri ?? null,
        online: !!live,
      };
    });
  }, [peers, circleUids, profile?.friends]);

  // Online verified responders visible right now. Honest count — it may be
  // small, but the number is real.
  const respondersNearby = peers.filter((p) => p.isVerified && p.userId !== profile?.uid).length;

  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';
  const greeting = greetingFor(new Date().getHours());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 500);
  }, []);

  const toggleVoice = async () => {
    if (busy) return;
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    try {
      if (voiceOn) {
        await stopBackgroundVoice();
        await saveBgVoiceState({ enabled: false, hours: 0 });
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
      await startBackgroundVoice([], 0).catch(() => undefined);
      await saveBgVoiceState({ enabled: true, hours: 0 });
      await requestBatteryExemption().catch(() => undefined);
      trackEvent('voice_sos_enabled', { from: 'home_hero' });
    } finally {
      setBusy(false);
    }
  };

  const onShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const res = await shareMyLocation();
      appAlert(
        res.ok ? 'Location shared' : "Couldn't share your location",
        res.ok
          ? res.contact
            ? `A maps link was sent to ${res.contact}, and your circle was notified.`
            : 'Your circle was notified with your location.'
          : res.error,
      );
    } finally {
      setSharing(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.brand} />
          }
        >
          {/* ── 1. Header ── */}
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.name} numberOfLines={1}>
                {firstName}
              </Text>
              <View style={styles.activeRow}>
                <View style={[styles.activeDot, { backgroundColor: voiceOn ? colors.sage : colors.textMuted }]} />
                <Text style={styles.activeText}>
                  {voiceOn ? 'ORBII is listening for you' : 'ORBII is ready'}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => navigation.navigate('Notifications')}
              style={styles.iconBtn}
              hitSlop={6}
              accessibilityLabel="Notifications"
            >
              <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              accessibilityLabel="Your profile"
            >
              {profile?.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>{firstName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
            </Pressable>
          </View>

          {/* ── 2. Voice SOS hero ── */}
          <VoiceHero on={voiceOn} busy={busy} onPress={toggleVoice} />

          {/* ── 3. Protection score + 4. Circle ── */}
          <View style={styles.midRow}>
            <ScoreRing pct={pct} onPress={() => navigation.navigate('SafetyReadiness')} />
            <CircleStrip
              members={members}
              onPress={() => navigation.navigate('Circles')}
            />
          </View>

          {/* ── 5. Bento grid ── */}
          <View style={styles.bento}>
            <Pressable
              onPress={() => navigation.navigate('CommunityAlerts')}
              style={({ pressed }) => [styles.bentoBig, pressed && styles.pressed]}
              accessibilityLabel="Responders nearby"
            >
              <PulseDots />
              <Text style={styles.bigNumber}>{respondersNearby}</Text>
              <Text style={styles.bigLabel}>verified helpers online</Text>
              <Text style={styles.bigHint}>Tap to see who's responding nearby</Text>
            </Pressable>

            <View style={styles.bentoCol}>
              <Pressable
                onPress={() => comingSoon('Fake call')}
                style={({ pressed }) => [styles.bentoSmall, pressed && styles.pressed]}
                accessibilityLabel="Fake call"
              >
                <View style={styles.smallIcon}>
                  <Ionicons name="call-outline" size={18} color={colors.brandDeep} />
                </View>
                <Text style={styles.smallLabel}>Fake call</Text>
                <Text style={styles.smallHint}>Escape a moment</Text>
              </Pressable>
              <Pressable
                onPress={() => navigation.navigate('SafeJourneyStart')}
                style={({ pressed }) => [styles.bentoSmall, pressed && styles.pressed]}
                accessibilityLabel="Safe journey"
              >
                <View style={styles.smallIcon}>
                  <Ionicons name="navigate-outline" size={18} color={colors.brandDeep} />
                </View>
                <Text style={styles.smallLabel}>Safe journey</Text>
                <Text style={styles.smallHint}>Watched travel</Text>
              </Pressable>
            </View>
          </View>

          {/* Share location (full width) */}
          <Pressable
            onPress={onShare}
            disabled={sharing}
            style={({ pressed }) => [styles.shareBtn, (sharing || pressed) && { opacity: 0.9 }]}
            accessibilityLabel="Share my live location"
          >
            <Ionicons name="paper-plane" size={18} color={colors.textInverse} />
            <Text style={styles.shareText}>{sharing ? 'Sharing…' : 'Share my live location'}</Text>
          </Pressable>

          {/* Record evidence + Community small row */}
          <View style={styles.rowTwo}>
            <Pressable
              onPress={() => navigation.navigate('Recordings')}
              style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
            >
              <Ionicons name="recording-outline" size={18} color={colors.brandDeep} />
              <Text style={styles.miniLabel}>Recordings</Text>
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('CommunityFeed')}
              style={({ pressed }) => [styles.miniCard, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={colors.brandDeep} />
              <Text style={styles.miniLabel}>Community</Text>
            </Pressable>
          </View>

          {/* Premium (tier-aware) */}
          {tier !== 'family' ? (
            <Pressable
              onPress={() => navigation.navigate('PremiumUpgrade')}
              style={({ pressed }) => [styles.proCard, pressed && styles.pressed]}
              accessibilityLabel={tier === 'plus' ? 'Upgrade to Family' : 'Upgrade to Plus'}
            >
              <View style={styles.proIcon}>
                <Ionicons name="sparkles" size={17} color={colors.goldDeep} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.proTitle}>
                  {tier === 'plus' ? 'Upgrade to ORBII Family' : 'Go Pro with ORBII Plus'}
                </Text>
                <Text style={styles.proSub}>
                  {tier === 'plus'
                    ? 'Protect up to 4 people you love.'
                    : 'Verified helpers reach you, not just your circle.'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.goldDeep} />
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ── Voice hero: an animated, breathing microphone ──────────────────────────
function VoiceHero({ on, busy, onPress }: { on: boolean; busy: boolean; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!on) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [on, pulse]);

  const ring1 = { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }) };
  const ring2 = { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) }], opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] }) };

  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.hero, on && styles.heroOn, pressed && { opacity: 0.96 }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel="Voice SOS"
    >
      <View style={styles.heroMicWrap}>
        {on ? <Animated.View style={[styles.heroRing, ring2]} /> : null}
        {on ? <Animated.View style={[styles.heroRing, ring1]} /> : null}
        <View style={[styles.heroMic, on && styles.heroMicOn]}>
          <Ionicons name={on ? 'mic' : 'mic-outline'} size={40} color={on ? colors.brand : colors.textInverse} />
        </View>
      </View>
      <Text style={styles.heroTitle}>{on ? 'Voice SOS is on' : 'Activate Voice SOS'}</Text>
      <Text style={styles.heroSub}>
        {on ? 'Just shout “help, help”. I’m listening, even in the background.' : 'Tap once. Then you never have to touch your phone to get help.'}
      </Text>
    </Pressable>
  );
}

// ── Circular protection score ──────────────────────────────────────────────
function ScoreRing({ pct, onPress }: { pct: number; onPress: () => void }) {
  const size = 128;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.scoreCard, pressed && styles.pressed]}
      accessibilityLabel={`Protection score ${pct} percent`}
    >
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.creamDeep} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.brand}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>
        <Text style={styles.scoreNum}>{pct}</Text>
        <Text style={styles.scoreUnit}>protected</Text>
      </View>
    </Pressable>
  );
}

// ── Life360-style circle strip ─────────────────────────────────────────────
function CircleStrip({
  members,
  onPress,
}: {
  members: { uid: string; name: string; photoUri: string | null; online: boolean }[];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.circleCard, pressed && styles.pressed]}
      accessibilityLabel="Your circle"
    >
      <Text style={styles.circleTitle}>Your circle</Text>
      {members.length === 0 ? (
        <View style={styles.circleEmpty}>
          <Ionicons name="person-add-outline" size={20} color={colors.brandDeep} />
          <Text style={styles.circleEmptyText}>Add the people you trust</Text>
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
          {members.slice(0, 8).map((m) => (
            <View key={m.uid} style={styles.member}>
              <View style={[styles.memberRing, { borderColor: m.online ? colors.sage : colors.creamDeep }]}>
                {m.photoUri ? (
                  <Image source={{ uri: m.photoUri }} style={styles.memberImg} />
                ) : (
                  <View style={styles.memberFallback}>
                    <Text style={styles.memberInitial}>{m.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.memberName} numberOfLines={1}>
                {m.name.split(' ')[0]}
              </Text>
              <Text style={[styles.memberState, { color: m.online ? colors.sageDeep : colors.textMuted }]}>
                {m.online ? 'Safe' : 'Offline'}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </Pressable>
  );
}

// ── Pulsing dots for the "helpers nearby" card ─────────────────────────────
function PulseDots() {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(a, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(a, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [a]);
  const op = a.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });
  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseDot, { opacity: op }]} />
      <Animated.View style={[styles.pulseDot, { opacity: a }]} />
      <Animated.View style={[styles.pulseDot, { opacity: op }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingTop: spacing.xs },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingTop: spacing.sm },
  greeting: { ...typography.caption, fontSize: 13, color: colors.textSecondary },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginTop: -2,
  },
  activeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  activeDot: { width: 7, height: 7, borderRadius: 4 },
  activeText: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.brandDeep },

  hero: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  heroOn: { backgroundColor: colors.brandSoft },
  heroMicWrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  heroRing: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brand,
  },
  heroMic: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.hero,
  },
  heroMicOn: { backgroundColor: colors.surface },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 19,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  heroSub: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },

  midRow: { flexDirection: 'row', gap: spacing.md },
  scoreCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  scoreNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 34, color: colors.textPrimary, lineHeight: 38 },
  scoreUnit: { ...typography.caption, fontSize: 11, color: colors.textSecondary, marginTop: -2 },

  circleCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    justifyContent: 'center',
    ...shadows.card,
  },
  circleTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  circleEmpty: { alignItems: 'center', gap: 6, paddingVertical: spacing.md },
  circleEmptyText: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, textAlign: 'center' },
  member: { alignItems: 'center', width: 56 },
  memberRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2.5,
    padding: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberImg: { width: '100%', height: '100%', borderRadius: 22 },
  memberFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.brandDeep },
  memberName: { fontFamily: fontFamilies.interMedium, fontSize: 11, color: colors.textPrimary, marginTop: 4 },
  memberState: { ...typography.caption, fontSize: 9.5 },

  bento: { flexDirection: 'row', gap: spacing.md },
  bentoBig: {
    flex: 1.25,
    backgroundColor: colors.brand,
    borderRadius: radius.xl,
    padding: spacing.lg,
    justifyContent: 'flex-end',
    minHeight: 160,
    ...shadows.card,
  },
  pulseWrap: { flexDirection: 'row', gap: 5, position: 'absolute', top: spacing.md, left: spacing.lg },
  pulseDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textInverse },
  bigNumber: { fontFamily: fontFamilies.poppinsBold, fontSize: 44, color: colors.textInverse, lineHeight: 48 },
  bigLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textInverse, opacity: 0.95 },
  bigHint: { ...typography.caption, fontSize: 11, color: colors.textInverse, opacity: 0.8, marginTop: 4 },

  bentoCol: { flex: 1, gap: spacing.md },
  bentoSmall: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    justifyContent: 'center',
    gap: 4,
    ...shadows.card,
  },
  smallIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  smallLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  smallHint: { ...typography.caption, fontSize: 10.5, color: colors.textSecondary },

  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.pill,
    paddingVertical: 15,
    ...shadows.card,
  },
  shareText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textInverse },

  rowTwo: { flexDirection: 'row', gap: spacing.md },
  miniCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  miniLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },

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
  proTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 14, color: colors.textPrimary },
  proSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1 },
});
