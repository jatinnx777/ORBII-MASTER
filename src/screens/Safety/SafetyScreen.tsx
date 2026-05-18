import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ScreenContainer, useBrandSheet } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppSelector } from '@/redux/store';
import { trackEvent } from '@/services/analytics';
import { createSOS } from '@/services/sos';
import {
  checkBreaches,
  fetchCrimeReports,
  fetchSystemStatus,
  type BreachResult,
  type SystemStatus,
} from '@/services/safety';
import {
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Tier is shown as a badge on each card (SILVER / GOLD / PLATINUM)
// even when the feature is unlocked — it tells the user what plan
// the feature WILL be on once paid plans are restored.
import {
  type Feature,
  type Tier,
  canUse,
  tierFor,
  useEntitlement,
} from '@/services/entitlements';

export function SafetyScreen() {
  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Header />
        <ActiveProtectionSection />
        <DigitalSafetySection />
        <PersonalSafetySection />
        <IntelligenceSection />
        <SystemStatusSection />
      </ScrollView>
    </ScreenContainer>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Safety</Text>
      <Text style={styles.subtitle}>
        Your protection layer — digital, physical, and informational.
      </Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ---------------------------------------------------------------------------
// Active Protection — Ghost Mode + Deadman Timer (both Silver-tier)
// ---------------------------------------------------------------------------

function ActiveProtectionSection() {
  const navigation = useNavigation<Nav>();
  const ghost = useAppSelector((s) => s.safetyModes.ghost);
  const deadman = useAppSelector((s) => s.safetyModes.deadman);
  const ghostUnlocked = useEntitlement('ghost_mode');
  const deadmanUnlocked = useEntitlement('deadman_timer');

  const openGhost = () => {
    if (!ghostUnlocked) {
      navigation.navigate('PremiumUpgrade');
      return;
    }
    if (ghost.active) navigation.navigate('GhostActive');
    else navigation.navigate('GhostStart');
  };

  const openDeadman = () => {
    if (!deadmanUnlocked) {
      navigation.navigate('PremiumUpgrade');
      return;
    }
    if (deadman.active) navigation.navigate('DeadmanActive');
    else navigation.navigate('DeadmanStart');
  };

  const remainingMs =
    deadman.active && deadman.expiresAt
      ? Math.max(0, deadman.expiresAt - Date.now())
      : 0;

  return (
    <>
      <SectionHeader title="Active Protection" />

      <FeatureCard
        icon="eye"
        title="Ghost Mode"
        description="Quietly tracks your trip and flags if anything looks off."
        tier={tierFor('ghost_mode')}
        locked={!ghostUnlocked}
        onUnlock={() => navigation.navigate('PremiumUpgrade')}
        onPress={openGhost}
      >
        {ghost.active ? (
          <View style={styles.statusRow}>
            <View style={[styles.liveDot, styles.liveDotActive]} />
            <Text style={styles.statusText}>
              Watching · headed to {ghost.destinationLabel ?? 'destination'}
            </Text>
          </View>
        ) : ghostUnlocked ? (
          <Text style={styles.cardSub}>
            Tap to start a silent trip — destination, ride, optional note.
          </Text>
        ) : null}
      </FeatureCard>

      <FeatureCard
        icon="hourglass-outline"
        title="Deadman Timer"
        description="A countdown that alerts your circle if you don't cancel it."
        tier={tierFor('deadman_timer')}
        locked={!deadmanUnlocked}
        onUnlock={() => navigation.navigate('PremiumUpgrade')}
        onPress={openDeadman}
      >
        {deadman.active ? (
          <View style={styles.statusRow}>
            <View style={[styles.liveDot, styles.liveDotActive]} />
            <Text style={styles.statusText}>
              Running ·{' '}
              {Math.floor(remainingMs / 60_000)}m{' '}
              {Math.floor((remainingMs % 60_000) / 1000)}s left
            </Text>
          </View>
        ) : deadmanUnlocked ? (
          <Text style={styles.cardSub}>
            Tap to set a check-in timer before risky moments.
          </Text>
        ) : null}
      </FeatureCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section 1 — Digital Safety
// ---------------------------------------------------------------------------

function DigitalSafetySection() {
  const profile = useAppSelector((s) => s.user.profile);
  const sheet = useBrandSheet();
  const [enabled, setEnabled] = useState(false);
  const [result, setResult] = useState<BreachResult | null>(null);
  const [loading, setLoading] = useState(false);

  const runCheck = useCallback(async () => {
    if (!profile?.email) return;
    setLoading(true);
    try {
      const r = await checkBreaches(profile.email);
      setResult(r);
    } finally {
      setLoading(false);
    }
  }, [profile?.email]);

  useEffect(() => {
    if (enabled && !result && profile?.email) runCheck();
  }, [enabled, result, profile?.email, runCheck]);

  const breachCount = result?.breaches?.length ?? 0;
  const status = !enabled
    ? 'Off — not monitoring your email.'
    : loading
      ? 'Scanning known breach databases…'
      : !result
        ? 'Ready to scan your email.'
        : breachCount === 0
          ? `No exposures found for ${result.email}.`
          : `${breachCount} exposure${breachCount === 1 ? '' : 's'} found. Tap for details.`;

  const handleDetails = () => {
    if (!result || !result.breaches || result.breaches.length === 0) return;
    sheet.notify({
      title: 'Where your email appeared',
      body: result.breaches.join('\n'),
      tone: 'warning',
      icon: 'shield-half',
    });
  };

  return (
    <>
      <SectionHeader title="Digital Safety" />
      <FeatureCard
        icon="lock-closed"
        title="Data Breach Alerts"
        description="Check if your email has appeared in known data breaches."
        tier="free"
        right={
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            trackColor={{ false: colors.border, true: colors.brandSoft }}
            thumbColor={enabled ? colors.brandDeep : colors.background}
          />
        }
      >
        <Pressable
          onPress={handleDetails}
          disabled={breachCount === 0}
          style={({ pressed }) => [
            styles.statusRow,
            breachCount > 0 && styles.statusRowAlert,
            pressed && breachCount > 0 && styles.pressed,
          ]}
        >
          <Ionicons
            name={
              breachCount === 0
                ? 'checkmark-circle'
                : 'alert-circle'
            }
            size={16}
            color={breachCount === 0 ? colors.brandDeep : colors.warning}
          />
          <Text style={styles.statusText} numberOfLines={2}>
            {status}
          </Text>
        </Pressable>
      </FeatureCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Personal Safety Core
// ---------------------------------------------------------------------------

function PersonalSafetySection() {
  return (
    <>
      <SectionHeader title="Personal Safety" />
      <VoiceSOSCard />
      <EmergencySOSCard />
    </>
  );
}

function VoiceSOSCard() {
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>('idle');
  const listening = voiceStatus === 'listening' || voiceStatus === 'starting';
  const backgroundVoice = useAppSelector((s) => s.app.backgroundVoice);

  useEffect(() => subscribeStatus(setVoiceStatus), []);

  const toggle = async () => {
    if (listening) {
      stopListening();
      return;
    }
    await startListening();
  };

  // Honest framing: foreground listening works; background listening is a
  // best-effort beta because Android OEMs throttle the mic API. The UI
  // tells the user exactly what to expect.
  const statusLine = listening
    ? backgroundVoice
      ? 'Listening · background reliability is best-effort'
      : 'Listening while ORBII is open'
    : 'Tap to start listening for "help", "bachao", or "madad"';

  return (
    <FeatureCard
      icon="mic"
      title="Voice SOS"
      description='Says "help" or "bachao" and ORBII fires an SOS hands-free.'
      tier="free"
      right={
        <Switch
          value={listening}
          onValueChange={toggle}
          trackColor={{ false: colors.border, true: colors.brandSoft }}
          thumbColor={listening ? colors.brandDeep : colors.background}
        />
      }
    >
      <View style={styles.voiceStatusRow}>
        <Waveform active={listening} />
        <View style={{ flex: 1 }}>
          <Text
            style={[
              styles.voiceStatusText,
              listening && { color: colors.brandDeep },
            ]}
            numberOfLines={2}
          >
            {statusLine}
          </Text>
        </View>
        {backgroundVoice && listening ? (
          <View style={styles.betaPill}>
            <Text style={styles.betaPillText}>BETA</Text>
          </View>
        ) : null}
      </View>
    </FeatureCard>
  );
}

// 5-bar mini equaliser. Bars only animate when `active` is true.
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
          Animated.timing(b, {
            toValue: 1,
            duration: 320 + i * 60,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(b, {
            toValue: 0.4,
            duration: 320 + i * 60,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
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
              height: b.interpolate({
                inputRange: [0, 1],
                outputRange: [4, 22],
              }),
              backgroundColor: active ? colors.brandDeep : colors.textMuted,
            },
          ]}
        />
      ))}
    </View>
  );
}

function EmergencySOSCard() {
  const sheet = useBrandSheet();
  const navigation = useNavigation<Nav>();
  const profile = useAppSelector((s) => s.user.profile);
  const lastSOS = useAppSelector(
    (s) => s.history.records.find((r) => r.kind !== 'test') ?? null,
  );
  const activeSOS = useAppSelector((s) => s.sos.activeSOS);
  const [firing, setFiring] = useState(false);

  const lastLabel = lastSOS
    ? new Date(lastSOS.timestamp).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'No alerts yet';

  const status = activeSOS ? 'Active' : 'Idle';

  const handleTest = async () => {
    if (!profile) return;
    setFiring(true);
    try {
      // kind='test' skips both the broadcast and the DB write — pure
      // dry run, no real helpers notified.
      await createSOS(
        profile,
        {
          latitude: 0,
          longitude: 0,
          address: 'Test location',
        },
        'test',
      );
      trackEvent('sos_triggered', { kind: 'test', source: 'safety_tab' });
      sheet.notify({
        title: 'Test alert sent',
        body: 'No real helpers were notified. This was a dry run.',
        tone: 'success',
        icon: 'shield-checkmark',
      });
    } finally {
      setFiring(false);
    }
  };

  return (
    <FeatureCard
      icon="alert-circle"
      title="Emergency SOS"
      description="Fires the radius broadcast and calls priority responders."
      tier="free"
    >
      <View style={styles.metaRow}>
        <Meta label="Status" value={status} highlight={status === 'Active'} />
        <Meta label="Last alert" value={lastLabel} />
      </View>
      <View style={styles.actionRow}>
        <Pressable
          onPress={handleTest}
          disabled={firing}
          style={({ pressed }) => [
            styles.secondaryBtn,
            (pressed || firing) && styles.pressed,
          ]}
        >
          <Ionicons name="flash" size={14} color={colors.textPrimary} />
          <Text style={styles.secondaryBtnText}>
            {firing ? 'Sending…' : 'Test alert'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('SOSCountdown')}
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="warning" size={14} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Send real SOS</Text>
        </Pressable>
      </View>
    </FeatureCard>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Intelligence
// ---------------------------------------------------------------------------

function IntelligenceSection() {
  const navigation = useNavigation<Nav>();
  const point = useAppSelector((s) => s.sos.currentLocation);
  const heatmapUnlocked = useEntitlement('travel_heatmap');
  const crimeUnlocked = useEntitlement('crime_reports');
  const [crimeEnabled, setCrimeEnabled] = useState(false);
  const [crimeCount, setCrimeCount] = useState<number | null>(null);
  const [crimeLoading, setCrimeLoading] = useState(false);

  useEffect(() => {
    if (!crimeEnabled) {
      setCrimeCount(null);
      return;
    }
    setCrimeLoading(true);
    fetchCrimeReports(point ?? null)
      .then((r) => setCrimeCount(r.count30d))
      .finally(() => setCrimeLoading(false));
  }, [crimeEnabled, point?.latitude, point?.longitude]);

  return (
    <>
      <SectionHeader title="Intelligence" />

      <FeatureCard
        icon="map"
        title="Travel Safety Heatmap"
        description="Risk zones along your route — high, medium, low."
        tier={tierFor('travel_heatmap')}
        locked={!heatmapUnlocked}
        onUnlock={() => navigation.navigate('PremiumUpgrade')}
      >
        <Text style={styles.cardSub}>
          Tap to open the live heatmap of your area.
        </Text>
      </FeatureCard>

      <FeatureCard
        icon="newspaper"
        title="Crime Reports"
        description="Recent incidents reported within 2 km of you."
        tier={tierFor('crime_reports')}
        locked={!crimeUnlocked}
        onUnlock={() => navigation.navigate('PremiumUpgrade')}
        right={
          crimeUnlocked ? (
            <Switch
              value={crimeEnabled}
              onValueChange={setCrimeEnabled}
              trackColor={{ false: colors.border, true: colors.brandSoft }}
              thumbColor={crimeEnabled ? colors.brandDeep : colors.background}
            />
          ) : undefined
        }
      >
        {crimeUnlocked && crimeEnabled ? (
          <View style={styles.statusRow}>
            {crimeLoading ? (
              <ActivityIndicator size="small" color={colors.brandDeep} />
            ) : (
              <Ionicons name="information-circle" size={16} color={colors.brandDeep} />
            )}
            <Text style={styles.statusText}>
              {crimeLoading
                ? 'Pulling latest reports…'
                : crimeCount != null
                  ? `${crimeCount} incidents near you in the last 30 days.`
                  : 'No data yet — share location to populate.'}
            </Text>
          </View>
        ) : null}
      </FeatureCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — System Status
// ---------------------------------------------------------------------------

function SystemStatusSection() {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  const refresh = useCallback(async () => {
    const s = await fetchSystemStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const dotColor =
    status?.server === 'online'
      ? colors.brandDeep
      : status?.server === 'degraded'
        ? colors.warning
        : status?.server === 'offline'
          ? colors.primary
          : colors.textMuted;

  const verb =
    status?.server === 'online'
      ? 'Healthy'
      : status?.server === 'degraded'
        ? 'Slow'
        : status?.server === 'offline'
          ? 'Offline'
          : 'Checking…';

  const lastSync = status
    ? new Date(status.lastSyncAt).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '—';

  return (
    <>
      <SectionHeader title="System Status" />
      <FeatureCard
        icon="pulse"
        title="ORBII Servers"
        description="Realtime ping to the Supabase backbone."
        tier="free"
      >
        <View style={styles.statusGrid}>
          <View style={styles.statusCell}>
            <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
            <Text style={styles.statusValue}>{verb}</Text>
            <Text style={styles.statusLabel}>Server</Text>
          </View>
          <View style={styles.statusCell}>
            <Text style={styles.statusValue}>
              {status?.latencyMs != null && status.latencyMs >= 0
                ? `${status.latencyMs}ms`
                : '—'}
            </Text>
            <Text style={styles.statusLabel}>Latency</Text>
          </View>
          <View style={styles.statusCell}>
            <Text style={styles.statusValue}>{lastSync}</Text>
            <Text style={styles.statusLabel}>Last sync</Text>
          </View>
        </View>
      </FeatureCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Reusable feature card
// ---------------------------------------------------------------------------

function TierBadge({ tier, locked }: { tier: Tier; locked?: boolean }) {
  if (tier === 'free') return null;
  const label = tier.toUpperCase();
  return (
    <View
      style={[
        styles.tierBadge,
        tier === 'silver' && { backgroundColor: '#E6E8EC' },
        tier === 'gold' && { backgroundColor: '#FFF1CB' },
        tier === 'platinum' && { backgroundColor: '#E6EAFF' },
      ]}
    >
      {locked ? (
        <Ionicons name="lock-closed" size={9} color={colors.textPrimary} />
      ) : null}
      <Text style={styles.tierBadgeText}>{label}</Text>
    </View>
  );
}

function FeatureCard({
  icon,
  title,
  description,
  tier,
  locked,
  right,
  onUnlock,
  onPress,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  tier: Tier;
  locked?: boolean;
  right?: React.ReactNode;
  onUnlock?: () => void;
  onPress?: () => void;
  children?: React.ReactNode;
}) {
  const press = useRef(new Animated.Value(1)).current;
  const animateTo = (v: number) =>
    Animated.timing(press, {
      toValue: v,
      duration: 150,
      useNativeDriver: true,
    }).start();

  // Locked → tapping anywhere on the card sends the user to the
  // upgrade flow. Unlocked + onPress → tappable card. Otherwise
  // (toggle-only / read-only) the wrapper stays a plain View so
  // nested Switches / interactive children stay clickable.
  const handler = locked ? onUnlock : onPress;
  const Wrapper: React.ElementType = handler ? Pressable : View;
  const wrapperProps: Record<string, unknown> = handler
    ? {
        onPress: handler,
        onPressIn: () => animateTo(0.98),
        onPressOut: () => animateTo(1),
      }
    : {};

  return (
    <Animated.View style={{ transform: [{ scale: press }] }}>
      <Wrapper style={styles.card} {...wrapperProps}>
        <View style={styles.cardHead}>
          <View style={styles.iconChip}>
            <Ionicons name={icon} size={18} color={colors.brandDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.titleRow}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {title}
              </Text>
              <TierBadge tier={tier} locked={locked} />
            </View>
            <Text style={styles.cardDesc} numberOfLines={2}>
              {description}
            </Text>
          </View>
          {right ? <View>{right}</View> : null}
        </View>
        {locked ? (
          <View style={styles.lockBanner}>
            <Ionicons name="sparkles" size={14} color={colors.brandDeep} />
            <Text style={styles.lockText}>
              Unlock with the {tier === 'silver' ? 'Silver' : tier === 'gold' ? 'Gold' : 'Platinum'} plan
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textSecondary} />
          </View>
        ) : children ? (
          <View style={styles.cardBody}>{children}</View>
        ) : null}
      </Wrapper>
    </Animated.View>
  );
}

function Meta({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text
        style={[styles.metaValue, highlight && { color: colors.brandDeep }]}
      >
        {value}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
    gap: spacing.sm,
  },
  header: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 4,
  },
  sectionHeader: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: 4,
    paddingHorizontal: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 10,
    ...shadows.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconChip: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textPrimary,
    flexShrink: 1,
  },
  cardDesc: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  cardBody: {
    paddingLeft: 48,
  },
  cardSub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textSecondary,
  },
  tierBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.circle,
  },
  tierBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.textPrimary,
    letterSpacing: 0.6,
  },
  lockBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginLeft: 48,
  },
  lockText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.textMuted,
  },
  liveDotActive: {
    backgroundColor: colors.brandDeep,
  },
  statusRowAlert: {
    // Soft mint wash for "needs attention" — replaces the legacy warm
    // yellow that clashed with the spec palette.
    backgroundColor: colors.brandSoft,
  },
  statusText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  voiceStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  voiceStatusText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  betaPill: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.circle,
    backgroundColor: '#FFF1CB',
  },
  betaPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: '#7A4D00',
    letterSpacing: 0.6,
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
    gap: 16,
  },
  meta: {
    flex: 1,
  },
  metaLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  metaValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flex: 1,
  },
  secondaryBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.primary,
    flex: 1,
  },
  primaryBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textInverse,
  },
  statusGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statusCell: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  statusLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
