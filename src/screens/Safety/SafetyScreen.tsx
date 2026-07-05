import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconBadge, Mascot, ScreenContainer, useBrandSheet } from '@/components/common';
import type { BadgeTint } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { trackEvent } from '@/services/analytics';
import { createSOS } from '@/services/sos';
import {
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import { useEntitlement } from '@/services/entitlements';
import { READINESS_CAP, SAFETY_DISCLAIMER, useReadiness } from '@/services/readiness';
import {
  loadBgVoiceState,
  startBackgroundVoice,
} from '@/services/background-voice';
import { loadPhrases } from '@/services/voice-phrases';
import { getVoiceMetrics } from '@/services/voice-metrics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function SafetyScreen() {
  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Safety</Text>
          <Text style={styles.subtitle}>Everything that keeps you protected, in one place.</Text>
        </View>
        <ProtectionStatusCard />
        <SafetyReadinessCard />
        <WatchOverMe />
        <SectionHeader title="Personal Safety" />
        <VoiceSOSCard />
        <Text style={styles.disclaimer}>{SAFETY_DISCLAIMER}</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

// Honest, real-time "are you actually protected right now?" indicator. Reads
// whether background protection is armed AND the native engine is actually
// running, so the user is never falsely reassured (e.g. after an OEM kill or a
// reboot where the service couldn't auto-restart).
function ProtectionStatusCard() {
  const navigation = useNavigation<Nav>();
  const [bg, setBg] = useState<{ enabled: boolean; hours: number }>({ enabled: false, hours: 12 });
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await loadBgVoiceState();
    setBg(s);
    const m = await getVoiceMetrics();
    setRunning(!!m?.running);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
      const id = setInterval(refresh, 3000);
      return () => clearInterval(id);
    }, [refresh]),
  );

  const state: 'active' | 'paused' | 'off' =
    bg.enabled && running ? 'active' : bg.enabled ? 'paused' : 'off';

  const onPress = async () => {
    if (state === 'off') {
      navigation.navigate('VoicePhrases');
      return;
    }
    if (state === 'paused' && !busy) {
      setBusy(true);
      try {
        const phrases = await loadPhrases();
        await startBackgroundVoice(phrases, bg.hours);
        await refresh();
      } finally {
        setBusy(false);
      }
    }
  };

  const cfg = {
    active: {
      bg: colors.sageSoft,
      fg: colors.sageDeep,
      dot: colors.sage,
      icon: 'shield-checkmark' as const,
      title: 'Protection active',
      body: 'ORBII is listening for your safe phrase.',
    },
    paused: {
      bg: colors.coralSoft,
      fg: colors.coralDeep,
      dot: colors.coral,
      icon: 'alert-circle' as const,
      title: 'Protection paused',
      body: busy ? 'Resuming…' : 'Tap to resume background protection.',
    },
    off: {
      bg: colors.surfaceAlt,
      fg: colors.textSecondary,
      dot: colors.textMuted,
      icon: 'shield-outline' as const,
      title: 'Background protection off',
      body: 'Tap to set up always-on Voice SOS.',
    },
  }[state];

  return (
    <Pressable
      onPress={onPress}
      style={[styles.statusCard, { backgroundColor: cfg.bg }]}
      accessibilityRole="button"
    >
      <View style={styles.statusIcon}>
        <Ionicons name={cfg.icon} size={22} color={cfg.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.statusTitleRow}>
          <View style={[styles.statusDot, { backgroundColor: cfg.dot }]} />
          <Text style={[styles.statusTitle, { color: cfg.fg }]}>{cfg.title}</Text>
        </View>
        <Text style={styles.statusBody}>{cfg.body}</Text>
      </View>
      {state !== 'active' ? (
        <Ionicons name="chevron-forward" size={18} color={cfg.fg} />
      ) : null}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// Protection Strength — the live readiness score now lives here on the Safety
// tab (moved off Home). Shows the capped % + a progress bar; tapping opens the
// full checklist to fix what's missing.
function SafetyReadinessCard() {
  const navigation = useNavigation<Nav>();
  const { pct, doneCount, total } = useReadiness();
  const ready = pct >= READINESS_CAP;
  const barColor = ready ? colors.sage : colors.peachDeep;

  return (
    <Pressable
      onPress={() => navigation.navigate('SafetyReadiness')}
      style={({ pressed }) => [styles.readinessCard, pressed && { transform: [{ scale: 0.98 }] }]}
      accessibilityRole="button"
      accessibilityLabel={`Protection strength ${pct} percent. Tap to improve.`}
    >
      <View style={styles.readinessTop}>
        <View style={styles.readinessIcon}>
          <Ionicons name="shield-checkmark" size={22} color={colors.peachDeep} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.readinessTitle}>Protection Strength</Text>
          <Text style={styles.readinessBody}>
            {ready
              ? "You're fully set up and protected."
              : `${doneCount} of ${total} steps done. Finish to protect yourself fully.`}
          </Text>
        </View>
        <Text style={[styles.readinessPct, { color: barColor }]}>{pct}%</Text>
      </View>
      <View style={styles.readinessBarTrack}>
        <View
          style={[
            styles.readinessBarFill,
            { width: `${Math.max(pct, 4)}%`, backgroundColor: barColor },
          ]}
        />
      </View>
    </Pressable>
  );
}

/* ── Watch Over Me — one unified experience ─────────────── */
function WatchOverMe() {
  const navigation = useNavigation<Nav>();
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
  const ghost = useAppSelector((s) => s.safetyModes.ghost);
  const deadman = useAppSelector((s) => s.safetyModes.deadman);
  const ghostUnlocked = useEntitlement('ghost_mode');
  const deadmanUnlocked = useEntitlement('deadman_timer');

  const active =
    !!safeJourney || ghost.active || deadman.active
      ? safeJourney
        ? `Heading out, ETA ${new Date(safeJourney.etaMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`
        : ghost.active
          ? `Silent trip to ${ghost.destinationLabel ?? 'your destination'}`
          : 'Check-in timer running'
      : null;

  const openJourney = () =>
    navigation.navigate(safeJourney ? 'SafeJourneyActive' : 'SafeJourneyStart');
  const openGhost = () => {
    if (!ghostUnlocked) return navigation.navigate('PremiumUpgrade');
    navigation.navigate(ghost.active ? 'GhostActive' : 'GhostStart');
  };
  const openDeadman = () => {
    if (!deadmanUnlocked) return navigation.navigate('PremiumUpgrade');
    navigation.navigate(deadman.active ? 'DeadmanActive' : 'DeadmanStart');
  };

  const modes: {
    icon: keyof typeof Ionicons.glyphMap;
    tint: BadgeTint;
    title: string;
    body: string;
    locked?: boolean;
    onPress: () => void;
  }[] = [
    {
      icon: 'walk',
      tint: 'sage',
      title: 'Journey',
      body: "Tell us where you're going. If you don't arrive, we alert your circle.",
      onPress: openJourney,
    },
    {
      icon: 'eye-outline',
      tint: 'lavender',
      title: 'Silent watch',
      body: 'Your circle sees you live, with no alarm unless you go missing.',
      locked: !ghostUnlocked,
      onPress: openGhost,
    },
    {
      icon: 'hourglass-outline',
      tint: 'gold',
      title: 'Check-in timer',
      body: "A countdown before risky moments. Don't cancel it and we step in.",
      locked: !deadmanUnlocked,
      onPress: openDeadman,
    },
  ];

  return (
    <View style={styles.watchCard}>
      <View style={styles.watchHead}>
        <Mascot pose="shield" size={72} />
        <View style={{ flex: 1, marginLeft: spacing.sm }}>
          <Text style={styles.watchTitle}>Watch Over Me</Text>
          <Text style={styles.watchBody}>
            Let us keep an eye on you while you travel. We stay quiet until you need us.
          </Text>
        </View>
      </View>

      {active ? (
        <View style={styles.activeBanner}>
          <View style={styles.liveDot} />
          <Text style={styles.activeText}>{active}</Text>
        </View>
      ) : null}

      <View style={styles.modeList}>
        {modes.map((m, i) => (
          <Pressable
            key={m.title}
            onPress={m.onPress}
            style={({ pressed }) => [
              styles.modeRow,
              i > 0 && styles.modeDivider,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
          >
            <IconBadge icon={m.icon} tint={m.tint} size={42} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <View style={styles.modeTitleRow}>
                <Text style={styles.modeTitle}>{m.title}</Text>
                {m.locked ? (
                  <View style={styles.premiumPill}>
                    <Ionicons name="sparkles" size={9} color={colors.goldDeep} />
                    <Text style={styles.premiumPillText}>Premium</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.modeBody}>{m.body}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/* ── Voice SOS ──────────────────────────────────────────── */
function VoiceSOSCard() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>('idle');
  const listening = voiceStatus === 'listening' || voiceStatus === 'starting';

  useEffect(() => subscribeStatus(setVoiceStatus), []);

  const toggle = async () => {
    if (listening) return stopListening();
    await startListening();
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <IconBadge icon="mic" tint="lavender" size={42} />
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.cardTitle}>Voice SOS</Text>
          <Text style={styles.cardDesc}>Say your phrase and we fire an SOS, hands-free.</Text>
        </View>
        <Switch
          value={listening}
          onValueChange={toggle}
          trackColor={{ false: colors.border, true: colors.sageSoft }}
          thumbColor={listening ? colors.sage : colors.surface}
        />
      </View>
      <View style={styles.voiceStatusRow}>
        <Waveform active={listening} />
        <Text style={[styles.voiceStatusText, listening && { color: colors.lavenderDeep }]} numberOfLines={2}>
          {listening
            ? 'Listening while ORBII is open.'
            : 'Tap to listen for "help", "bachao", or "madad".'}
        </Text>
      </View>
    </View>
  );
}

function Waveform({ active }: { active: boolean }) {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0.4))).current;
  useEffect(() => {
    if (!active) {
      bars.forEach((b) => b.setValue(0.4));
      return;
    }
    const loops = bars.map((b, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(b, { toValue: 1, duration: 320 + i * 60, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
          Animated.timing(b, { toValue: 0.4, duration: 320 + i * 60, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, bars]);
  return (
    <View style={styles.waveform}>
      {bars.map((b, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              height: b.interpolate({ inputRange: [0, 1], outputRange: [4, 22] }),
              backgroundColor: active ? colors.lavender : colors.textMuted,
            },
          ]}
        />
      ))}
    </View>
  );
}

function Meta({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, highlight && { color: colors.coral }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 110,
    gap: spacing.md,
  },
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  title: {
    ...typography.displaySmall,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  sectionHeader: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.sm,
  },
  /* protection status indicator */
  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  statusIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15.5,
  },
  statusBody: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 1,
  },
  /* protection strength / safety readiness entry */
  readinessCard: {
    backgroundColor: colors.peachSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  readinessTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  readinessIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readinessTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15.5,
    color: colors.textPrimary,
  },
  readinessBody: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 1,
  },
  readinessPct: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  readinessBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  readinessBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  disclaimer: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 9.5,
    lineHeight: 13,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  /* watch over me */
  watchCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    ...shadows.card,
  },
  watchHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  watchTitle: {
    ...typography.h2,
    color: colors.textPrimary,
  },
  watchBody: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 19,
  },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.md,
  },
  activeText: {
    ...typography.label,
    color: colors.sageDeep,
    flex: 1,
  },
  modeList: {
    marginTop: spacing.md,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  modeDivider: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  modeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modeTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  modeBody: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 1,
  },
  premiumPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.goldSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  premiumPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.goldDeep,
    letterSpacing: 0.4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.sage,
  },
  /* generic card */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  cardDesc: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  voiceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  voiceStatusText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 24,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  meta: { flex: 1 },
  metaLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    flex: 1,
  },
  secondaryBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.coral,
    flex: 1,
  },
  primaryBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textInverse,
  },
  pressed: {
    opacity: 0.9,
  },
});
