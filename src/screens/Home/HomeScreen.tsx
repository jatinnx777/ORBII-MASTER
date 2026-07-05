import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SOSButton } from './components/SOSButton';
import {
  BatteryWarning,
  MascotLoader,
  MLMapView,
  PopIn,
  ScreenContainer,
  type MLMarker,
  type AvatarMarker,
} from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  helpersNearbyUpdated,
  locationErrored,
  locationPermissionChanged,
  locationUpdated,
} from '@/redux/slices/sosSlice';
import {
  getCurrentLocation,
  getCurrentPermission,
  requestPermission,
} from '@/services/location';
import { countHelpersNearby } from '@/services/helpers';
import {
  countPresenceNearby,
  joinPresence,
  listNearbyAlerts,
  subscribePresence,
  type PresencePeer,
} from '@/services/community';
import { alertsLoaded } from '@/redux/slices/communitySlice';
import {
  fireLocalNotification,
  getNotificationPermission,
  requestNotificationPermission,
} from '@/services/notifications';
import { formatDistance, haversineMeters } from '@/utils/geo';
import { trackEvent } from '@/services/analytics';
import { shouldDampenWork } from '@/services/battery-aware';
import { useNotificationsBadge } from '@/hooks/useNotificationsBadge';
import {
  backgroundVoiceAvailable,
  isBatteryExempt,
  loadBgVoiceState,
  requestBatteryExemption,
  saveBgVoiceState,
  startBackgroundVoice,
  stopBackgroundVoice,
} from '@/services/background-voice';
import { useIsPremium } from '@/services/entitlements';
import { loadPhrases } from '@/services/voice-phrases';
import {
  startListening,
  stopListening,
  subscribeKeyword,
  subscribeStatus,
  type VoiceDetectionStatus,
  type VoiceKeyword,
} from '@/services/voice-detection';
import type { AppStackParamList } from '@/navigation/types';
import type { GeoPoint, UserProfile } from '@/types';

const HELPER_REFRESH_MS = 30_000;
const MAP_RADIUS_KM = 5;

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const isPremium = useIsPremium();
  const { locationPermission, helpersNearby } = useAppSelector((s) => s.sos);
  // `helperVerified` is the legacy gig-economy flag (cut). Circle members
  // are now the only "helpers" — every peer the user trusts is implicitly
  // verified by virtue of being in their circle.
  const helperVerified = false;
  const nearbyAlerts = useAppSelector((s) => s.community.alerts);
  const activeCircleId = useAppSelector((s) => s.circles.activeCircleId);
  const circleMembers = useAppSelector((s) =>
    activeCircleId ? s.circles.membersByCircle[activeCircleId] ?? [] : [],
  );

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>('idle');
  const [helpersScanState, setHelpersScanState] = useState<'scanning' | 'resolved'>(
    'scanning',
  );
  const [presencePeers, setPresencePeers] = useState<PresencePeer[]>([]);

  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const currentLocationRef = useRef(currentLocation);
  useEffect(() => {
    currentLocationRef.current = currentLocation;
  }, [currentLocation]);

  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const loadLocationAndHelpers = useCallback(async () => {
    try {
      const point = await getCurrentLocation();
      dispatch(locationUpdated(point));
      const presenceCount = countPresenceNearby(point, profile?.uid ?? null, 5);
      dispatch(helpersNearbyUpdated(presenceCount));
      countHelpersNearby(point)
        .then((dbCount) => {
          if (dbCount > presenceCount) {
            dispatch(helpersNearbyUpdated(dbCount));
          }
        })
        .catch(() => undefined)
        .finally(() => setHelpersScanState('resolved'));
      const alerts = await listNearbyAlerts(point, 2, profile?.uid ?? null);
      dispatch(alertsLoaded(alerts));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not read location.';
      dispatch(locationErrored(message));
      setHelpersScanState('resolved');
    }
  }, [dispatch, profile?.uid]);

  useEffect(() => {
    if (helpersScanState !== 'scanning') return;
    const id = setTimeout(() => setHelpersScanState('resolved'), 3000);
    return () => clearTimeout(id);
  }, [helpersScanState]);

  const bootstrapPermission = useCallback(async () => {
    const existing = await getCurrentPermission();
    if (existing === 'granted') {
      dispatch(locationPermissionChanged('granted'));
      await loadLocationAndHelpers();
      return;
    }
    const next = await requestPermission();
    dispatch(locationPermissionChanged(next));
    if (next === 'granted') {
      await loadLocationAndHelpers();
    }
  }, [dispatch, loadLocationAndHelpers]);

  useEffect(() => {
    bootstrapPermission();
  }, [bootstrapPermission]);

  useEffect(() => {
    requestNotificationPermission().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (nearbyAlerts.length === 0) return;
    const fresh = nearbyAlerts.filter((a) => !seenAlertIds.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => {
      seenAlertIds.current.add(a.id);
      fireLocalNotification(
        'Someone nearby needs help',
        `${a.victim.name} is ${formatDistance(a.distanceMeters)} away. Tap to respond.`,
        { kind: 'community_alert', alertId: a.id },
        'sos',
      );
    });
  }, [nearbyAlerts]);

  useEffect(() => {
    if (locationPermission !== 'granted') return;
    refreshTimer.current = setInterval(() => {
      if (shouldDampenWork()) return;
      loadLocationAndHelpers();
    }, HELPER_REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [locationPermission, loadLocationAndHelpers]);

  const presenceHandleRef = useRef<{
    update: (loc: GeoPoint, isVerified?: boolean) => void;
    leave: () => void;
  } | null>(null);
  useEffect(() => {
    if (!profile?.uid) return;
    presenceHandleRef.current = joinPresence({
      userId: profile.uid,
      name: profile.name ?? 'Someone',
      photoUri: profile.photoUri ?? null,
      location: currentLocation ?? null,
      isVerified: helperVerified,
    });
    return () => {
      presenceHandleRef.current?.leave();
      presenceHandleRef.current = null;
    };
  }, [profile?.uid, profile?.name, profile?.photoUri, helperVerified]);

  useEffect(() => {
    if (currentLocation) presenceHandleRef.current?.update(currentLocation, helperVerified);
  }, [currentLocation, helperVerified]);

  useEffect(() => {
    const unsub = subscribePresence((peers) => {
      const me = profileRef.current?.uid ?? null;
      const others = peers.filter((p) => !me || p.userId !== me);
      setPresencePeers(others);
      const here = currentLocationRef.current;
      if (!here) {
        dispatch(helpersNearbyUpdated(others.length));
        return;
      }
      const count = others.filter((p) => {
        if (!p.location) return false;
        return haversineMeters(here, p.location) <= MAP_RADIUS_KM * 1000;
      }).length;
      dispatch(helpersNearbyUpdated(count));
    });
    return unsub;
  }, [dispatch]);

  const ensureLocationOrPrompt = (): boolean => {
    if (locationPermission === 'granted') return true;
    appAlert(
      'Enable location',
      'ORBII needs your location to dispatch helpers during an emergency.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open settings',
          onPress: () => Linking.openSettings().catch(() => undefined),
        },
      ],
    );
    return false;
  };

  const handleSOSPress = () => {
    if (!ensureLocationOrPrompt()) return;
    navigation.navigate('SOSCountdown');
  };

  const handleSOSLongPress = () => {
    if (!ensureLocationOrPrompt()) return;
    trackEvent('sos_instant_long_press');
    navigation.navigate('SOSCountdown', { instant: true });
  };

  const toggleListening = useCallback(async () => {
    if (voiceStatus === 'listening' || voiceStatus === 'starting') {
      stopListening();
      return;
    }
    const result = await startListening();
    if (!result.ok) {
      if (result.reason === 'permission-denied') {
        appAlert(
          'Microphone access needed',
          'ORBII listens for trigger words like "help" or "bachao" to fire an SOS hands-free. Enable microphone access in settings to turn this on.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Open settings',
              onPress: () => Linking.openSettings().catch(() => undefined),
            },
          ],
        );
      } else if (result.reason === 'expo-go' || result.reason === 'native-unavailable') {
        appAlert(
          'Voice SOS needs a dev build',
          'Voice detection uses a native module that Expo Go cannot load.',
        );
      } else {
        appAlert('Could not start listening', result.reason ?? 'Unknown error');
      }
    }
  }, [voiceStatus]);

  useEffect(() => {
    const unsub = subscribeStatus(setVoiceStatus);
    return unsub;
  }, []);

  // Background Voice SOS: the Home voice card is the single entry point. Tap
  // it → choose a duration → ORBII listens for the phrase even when closed.
  const [bgVoiceOn, setBgVoiceOn] = useState(false);
  // Device-level signals that feed Protection Strength. Refreshed every time
  // Home regains focus so the score reflects the latest permission state.
  const [batteryExempt, setBatteryExempt] = useState(false);
  const [notifOk, setNotifOk] = useState(false);
  const [micOk, setMicOk] = useState(false);
  const [protectionSheetOpen, setProtectionSheetOpen] = useState(false);

  const refreshProtectionSignals = useCallback(async () => {
    try {
      setBatteryExempt(await isBatteryExempt());
      setNotifOk(await getNotificationPermission());
      if (Platform.OS === 'android') {
        setMicOk(
          await PermissionsAndroid.check(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          ),
        );
      } else {
        setMicOk(true);
      }
    } catch {
      // best-effort — leave prior values
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBgVoiceState().then((s) => setBgVoiceOn(s.enabled));
      refreshProtectionSignals();
    }, [refreshProtectionSignals]),
  );

  const ensureMicPerms = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) return false;
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    }
    return true;
  }, []);

  const armBackground = useCallback(
    async (hours: number) => {
      const ok = await ensureMicPerms();
      if (!ok) {
        appAlert('Microphone needed', 'Allow microphone access so ORBII can listen for your phrase.');
        return;
      }
      const phrases = await loadPhrases();
      const started = await startBackgroundVoice(phrases, hours);
      if (!started) {
        appAlert('Not available', 'Background protection runs on the installed Android app.');
        return;
      }
      await saveBgVoiceState({ enabled: true, hours });
      setBgVoiceOn(true);

      // Reliability: phones aggressively kill background services. Exempt
      // ORBII from battery optimization, then point the user to OEM autostart.
      const exempt = await isBatteryExempt();
      if (!exempt) await requestBatteryExemption();
      setTimeout(() => {
        appAlert(
          'Keep ORBII running',
          'So voice protection survives in the background, allow Autostart and remove battery limits for ORBII.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Show me how', onPress: () => navigation.navigate('OEMHelp') },
          ],
        );
      }, 800);
    },
    [ensureMicPerms, navigation],
  );

  const handleVoiceCard = useCallback(async () => {
    if (!backgroundVoiceAvailable) {
      toggleListening();
      return;
    }
    // Free tier: in-app (foreground) voice trigger only — their one Voice SOS.
    // Background voice monitoring is an ORBII Plus feature.
    if (!isPremium) {
      toggleListening();
      return;
    }
    if (bgVoiceOn) {
      await stopBackgroundVoice();
      await saveBgVoiceState({ enabled: false, hours: 12 });
      setBgVoiceOn(false);
      return;
    }
    appAlert(
      'Protect me for…',
      'ORBII will keep listening for your phrase, even in the background.',
      [
        { text: '12 hours', onPress: () => armBackground(12) },
        { text: '24 hours', onPress: () => armBackground(24) },
        { text: 'Until I turn it off', onPress: () => armBackground(0) },
        { text: 'Cancel', style: 'cancel' },
      ],
    );
  }, [bgVoiceOn, armBackground, toggleListening, isPremium]);

  // Voice keyword → SOS is handled globally (and quota-gated) in App.tsx,
  // so Home no longer subscribes here (it would double-fire).

  useFocusEffect(
    useCallback(() => {
      return () => {
        // Voice listener keeps running across navigation. Only an explicit
        // toggle stops it.
      };
    }, []),
  );

  const insets = useSafeAreaInsets();
  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase();
  const firstName = (profile?.name ?? '').trim().split(/\s+/)[0] || 'there';
  const voiceListening = voiceStatus === 'listening' || voiceStatus === 'starting';
  const unreadCount = useNotificationsBadge();
  const contactsCount = profile?.emergencyContacts?.length ?? 0;

  // Build the marker list for the map. Keep markers within MAP_RADIUS_KM of
  // the user so the map stays focused on their immediate neighbourhood.
  // Active circle member ids → these peers render as photo avatars, not dots.
  const memberIds = useMemo(
    () => new Set(circleMembers.map((m) => m.userId)),
    [circleMembers],
  );

  const mapMarkers: MLMarker[] = useMemo(() => {
    const out: MLMarker[] = [];
    if (currentLocation) {
      out.push({ id: 'me', coordinate: currentLocation, kind: 'user' });
    }
    const here = currentLocation;
    presencePeers.forEach((peer) => {
      if (!peer.location) return;
      if (memberIds.has(peer.userId)) return; // shown as an avatar instead
      if (here) {
        const d = haversineMeters(here, peer.location);
        if (d > MAP_RADIUS_KM * 1000) return;
      }
      out.push({
        id: `peer:${peer.userId}`,
        coordinate: peer.location,
        kind: peer.isVerified ? 'helper-verified' : 'helper',
      });
    });
    return out;
  }, [currentLocation, presencePeers, memberIds]);

  // Circle members currently sharing location → avatar pins with their photo.
  const avatarMarkers: AvatarMarker[] = useMemo(() => {
    return presencePeers
      .filter((p) => p.location && memberIds.has(p.userId))
      .map((p) => ({
        id: `member:${p.userId}`,
        coordinate: p.location as GeoPoint,
        photoUri: p.photoUri,
        name: p.name,
      }));
  }, [presencePeers, memberIds]);

  const verifiedCount = useMemo(
    () =>
      presencePeers.filter(
        (p) =>
          p.isVerified &&
          p.location &&
          (!currentLocation ||
            haversineMeters(currentLocation, p.location) <= MAP_RADIUS_KM * 1000),
      ).length,
    [presencePeers, currentLocation],
  );

  const helperPhotos = useMemo(
    () => presencePeers.map((p) => p.photoUri).filter(Boolean).slice(0, 3) as string[],
    [presencePeers],
  );

  // Premium status derivations.
  const voiceOn = bgVoiceOn || voiceListening;
  const locationOk = locationPermission === 'granted';
  const hasContacts = contactsCount > 0;

  // ── Protection Strength ──────────────────────────────────
  // Eight weighted factors → a single 0-100% score. Background-reliability
  // (battery + autostart) and the two SOS engines carry the most weight
  // because they're what actually keeps protection alive when the phone is
  // pocketed. Autostart can't be queried on Android, so we treat the battery
  // exemption (granted in the same OEM flow) as its proxy.
  const protectionFactors = useMemo(
    () => [
      { key: 'voice', label: 'Voice SOS', weight: 20, ok: voiceOn },
      { key: 'background', label: 'Background protection', weight: 20, ok: bgVoiceOn },
      // Contacts outweigh battery/notification comfort: with zero contacts an
      // SOS reaches nobody at all, so it's the single most critical gap.
      { key: 'contacts', label: 'Emergency contacts', weight: 15, ok: hasContacts },
      { key: 'battery', label: 'Battery optimization off', weight: 10, ok: batteryExempt },
      { key: 'notifications', label: 'Notifications enabled', weight: 10, ok: notifOk },
      { key: 'microphone', label: 'Microphone access', weight: 10, ok: micOk },
      { key: 'location', label: 'Location access', weight: 10, ok: locationOk },
      { key: 'autostart', label: 'Autostart allowed', weight: 5, ok: batteryExempt },
    ],
    [voiceOn, bgVoiceOn, batteryExempt, notifOk, micOk, locationOk, hasContacts],
  );
  const protectionPct = useMemo(
    () =>
      protectionFactors.reduce((sum, f) => (f.ok ? sum + f.weight : sum), 0),
    [protectionFactors],
  );

  // Route a single unmet factor to the action that fixes it. Used by both the
  // per-row tap and the sheet's "Fix Now" button (which targets the highest-
  // weighted unmet factor).
  const handleFixFactor = useCallback(
    async (key: string) => {
      switch (key) {
        case 'voice':
        case 'background':
          setProtectionSheetOpen(false);
          handleVoiceCard();
          break;
        case 'battery':
          await requestBatteryExemption();
          await refreshProtectionSignals();
          break;
        case 'autostart':
          setProtectionSheetOpen(false);
          navigation.navigate('OEMHelp');
          break;
        case 'notifications':
          await requestNotificationPermission();
          await refreshProtectionSignals();
          break;
        case 'microphone':
          await ensureMicPerms();
          await refreshProtectionSignals();
          break;
        case 'location':
          setProtectionSheetOpen(false);
          await bootstrapPermission();
          break;
        case 'contacts':
          setProtectionSheetOpen(false);
          navigation.navigate('EmergencyContacts');
          break;
      }
    },
    [
      handleVoiceCard,
      refreshProtectionSignals,
      ensureMicPerms,
      bootstrapPermission,
      navigation,
    ],
  );

  return (
    <ScreenContainer padded={false} edges={['left', 'right']}>
      {currentLocation ? (
        <MLMapView
          center={currentLocation}
          zoom={15}
          markers={mapMarkers}
          avatarMarkers={avatarMarkers}
          interactive
          followUser={false}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.mapPlaceholder]}>
          <MascotLoader message="Getting your map ready…" />
        </View>
      )}

      <View
        style={[styles.headerFloat, { paddingTop: insets.top + spacing.xs }]}
        pointerEvents="box-none"
      >
        <HomeHeader
          profile={profile}
          initial={initial}
          unreadCount={unreadCount}
          onProfilePress={() => navigation.navigate('Tabs', { screen: 'Profile' })}
          onSettingsPress={() => navigation.navigate('Settings')}
          onNotificationsPress={() => navigation.navigate('Notifications')}
        />
      </View>

      <BottomPanel bottomInset={insets.bottom}>
        {/* ── Greeting + all-clear status ────────────────── */}
        <PopIn delay={0}>
          <View style={styles.greetingRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greetingHi} numberOfLines={1}>
                Hi {firstName}
              </Text>
              <Text style={styles.greetingSub}>
                {!locationOk
                  ? 'Enable location so we can dispatch help.'
                  : !hasContacts
                    ? 'No emergency contacts yet. An SOS right now reaches no one.'
                    : "You're all set. Help is one tap away."}
              </Text>
            </View>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor:
                    locationOk && hasContacts ? colors.sage : colors.peachDeep,
                },
              ]}
            />
          </View>
        </PopIn>

        {/* Protection Strength moved to the Safety tab → Safety Readiness. */}

        <BatteryWarning />

        {!locationOk ? (
          <Pressable
            onPress={bootstrapPermission}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="location" size={18} color={colors.coralDeep} />
            <Text style={styles.permissionText}>Enable location for emergencies</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.coralDeep} />
          </Pressable>
        ) : !hasContacts ? (
          // Loss-framed: the cost of skipping this is stated, not implied.
          <Pressable
            onPress={() => navigation.navigate('EmergencyContacts')}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="people" size={18} color={colors.coralDeep} />
            <Text style={styles.permissionText}>
              Add trusted contacts, alerts go nowhere without them
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.coralDeep} />
          </Pressable>
        ) : null}

        {/* ── SOS + Voice cards ──────────────────────────── */}
        <PopIn delay={120}>
          <View style={styles.actionRow}>
            <SOSButton onPress={handleSOSPress} onLongPress={handleSOSLongPress} />
            <VoiceCard listening={voiceOn} onPress={handleVoiceCard} />
          </View>
        </PopIn>

        {/* ── Helpers ────────────────────────────────────── */}
        <PopIn delay={220}>
          <HelpersCard
            photos={helperPhotos}
            count={helpersNearby}
            onPress={() => navigation.navigate('Circles')}
          />
        </PopIn>

        {nearbyAlerts.length > 0 ? (
          <AlertsStrip
            count={nearbyAlerts.length}
            onPress={() => navigation.navigate('CommunityAlerts')}
          />
        ) : null}
      </BottomPanel>
    </ScreenContainer>
  );
}

/* ── voice trigger card ─────────────────────────────────── */
function VoiceCard({ listening, onPress }: { listening: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.voiceCard, pressed && styles.pressedScale]}
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop voice trigger' : 'Start hands-free SOS'}
    >
      <Text style={styles.voiceTitle}>Voice SOS</Text>
      <Text style={styles.voiceHint}>{listening ? 'Protecting you' : 'Tap to turn on'}</Text>
      <Waveform active={listening} />
    </Pressable>
  );
}

const BAR_COUNT = 18;
function Waveform({ active }: { active: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      anim.stopAnimation();
      anim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, anim]);

  return (
    <View style={styles.waveform}>
      {Array.from({ length: BAR_COUNT }).map((_, i) => {
        const base = 6 + Math.abs(Math.sin(i * 0.9)) * 18;
        const peak = 6 + Math.abs(Math.sin(i * 0.9 + 1)) * 22;
        const height = active
          ? anim.interpolate({ inputRange: [0, 1], outputRange: [base, peak] })
          : base;
        return (
          <Animated.View
            key={i}
            style={[styles.waveBar, { height: height as never }]}
          />
        );
      })}
    </View>
  );
}

/* ── protection strength ────────────────────────────────── */
type ProtectionFactor = {
  key: string;
  label: string;
  weight: number;
  ok: boolean;
};

// One source of truth for the colour band + headline copy at a given score.
// Four colour bands, three copy tiers (medium spans the two amber bands).
function protectionBand(pct: number): {
  color: string;
  soft: string;
  label: string;
} {
  if (pct >= 95) return { color: colors.sage, soft: colors.sageSoft, label: 'Excellent Protection' };
  if (pct >= 75) return { color: colors.peachDeep, soft: colors.peachSoft, label: 'Almost Ready' };
  if (pct >= 50) return { color: '#E59A4F', soft: '#FBEBD9', label: 'Almost Ready' };
  return { color: colors.coral, soft: colors.coralSoft, label: 'Action Needed' };
}

// Slim premium status pill — modelled on Apple's Battery Health row. One
// compact card: label + score on top, a thin progress bar + headline below.
// Tapping opens the detail sheet. NOT a section, NOT a big card.
function ProtectionStrengthPill({
  pct,
  onPress,
}: {
  pct: number;
  onPress: () => void;
}) {
  const band = protectionBand(pct);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.strengthPill, pressed && styles.pressedScale]}
      accessibilityRole="button"
      accessibilityLabel={`Protection strength ${pct} percent. ${band.label}. Tap for details.`}
    >
      <View style={styles.strengthTopRow}>
        <View style={[styles.strengthIcon, { backgroundColor: band.soft }]}>
          <Ionicons name="shield-checkmark" size={13} color={band.color} />
        </View>
        <Text style={styles.strengthLabel}>Protection Strength</Text>
        <Text style={[styles.strengthPct, { color: band.color }]}>{pct}%</Text>
        <Ionicons name="chevron-forward" size={15} color={colors.textMuted} />
      </View>
      <View style={styles.strengthBarTrack}>
        <View
          style={[
            styles.strengthBarFill,
            { width: `${Math.max(pct, 4)}%`, backgroundColor: band.color },
          ]}
        />
      </View>
      <Text style={[styles.strengthStatus, { color: band.color }]}>{band.label}</Text>
    </Pressable>
  );
}

// Bottom sheet (Modal) — the checklist behind the score. Each factor shows a
// ✓ when satisfied or a ⚠ + weight when missing. "Fix Now" targets the
// highest-impact unmet factor.
function ProtectionSheet({
  visible,
  pct,
  factors,
  onClose,
  onFix,
}: {
  visible: boolean;
  pct: number;
  factors: ProtectionFactor[];
  onClose: () => void;
  onFix: (key: string) => void;
}) {
  const band = protectionBand(pct);
  // Highest-weighted unmet factor — what "Fix Now" should target.
  const nextFix = factors
    .filter((f) => !f.ok)
    .sort((a, b) => b.weight - a.weight)[0];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.sheetBackdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.sheetHandle} />
        <View style={styles.sheetHeader}>
          <View>
            <Text style={styles.sheetTitle}>Protection Strength</Text>
            <Text style={[styles.sheetStatus, { color: band.color }]}>{band.label}</Text>
          </View>
          <Text style={[styles.sheetPct, { color: band.color }]}>{pct}%</Text>
        </View>

        <View style={styles.sheetBarTrack}>
          <View
            style={[
              styles.sheetBarFill,
              { width: `${Math.max(pct, 4)}%`, backgroundColor: band.color },
            ]}
          />
        </View>

        <View style={styles.sheetList}>
          {factors.map((f) => (
            <Pressable
              key={f.key}
              disabled={f.ok}
              onPress={() => onFix(f.key)}
              style={styles.sheetRow}
            >
              <View
                style={[
                  styles.sheetRowIcon,
                  { backgroundColor: f.ok ? colors.sageSoft : colors.coralSoft },
                ]}
              >
                <Ionicons
                  name={f.ok ? 'checkmark' : 'warning'}
                  size={14}
                  color={f.ok ? colors.sageDeep : colors.coralDeep}
                />
              </View>
              <Text style={styles.sheetRowLabel}>{f.label}</Text>
              {f.ok ? (
                <Text style={styles.sheetRowDone}>+{f.weight}%</Text>
              ) : (
                <Text style={styles.sheetRowFix}>Fix</Text>
              )}
            </Pressable>
          ))}
        </View>

        {nextFix ? (
          <Pressable
            style={({ pressed }) => [styles.sheetCta, pressed && styles.pressedScale]}
            onPress={() => onFix(nextFix.key)}
            accessibilityRole="button"
          >
            <Ionicons name="flash" size={16} color={colors.textInverse} />
            <Text style={styles.sheetCtaText}>Fix Now: {nextFix.label}</Text>
          </Pressable>
        ) : (
          <View style={[styles.sheetCta, styles.sheetCtaDone]}>
            <Ionicons name="shield-checkmark" size={16} color={colors.sageDeep} />
            <Text style={[styles.sheetCtaText, { color: colors.sageDeep }]}>
              You're fully protected
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

/* ── helpers card (overlapping avatars) ─────────────────── */
function HelpersCard({
  photos,
  count,
  onPress,
}: {
  photos: string[];
  count: number;
  onPress: () => void;
}) {
  const avatars = photos.slice(0, 3);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, styles.helpersCard, pressed && styles.pressedScale]}
      accessibilityRole="button"
    >
      <View style={styles.avatarStack}>
        {avatars.length > 0
          ? avatars.map((uri, i) => (
              <View key={i} style={[styles.stackAvatarWrap, { marginLeft: i === 0 ? 0 : -12, zIndex: 3 - i }]}>
                <Image source={{ uri }} style={styles.stackAvatar} />
                <View style={styles.onlineDot} />
              </View>
            ))
          : [0, 1, 2].map((i) => (
              <View
                key={i}
                style={[styles.stackAvatarWrap, styles.stackAvatarEmpty, { marginLeft: i === 0 ? 0 : -12, zIndex: 3 - i }]}
              >
                <Ionicons name="person" size={15} color={colors.lavenderDeep} />
              </View>
            ))}
      </View>
      <View style={{ flex: 1, marginLeft: spacing.md }}>
        <View style={styles.helpersTitleRow}>
          <Text style={styles.cardTitle}>
            {count > 0 ? `${count} Helper${count === 1 ? '' : 's'} nearby` : 'Build your circle'}
          </Text>
          {count > 0 ? (
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={10} color={colors.sageDeep} />
              <Text style={styles.verifiedText}>Verified</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.cardSub}>
          {count > 0 ? 'Available now, tap to view' : 'Invite people you trust'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/* ── guardian status line ───────────────────────────────── */
function StatusLine({
  label,
  ok,
  pendingLabel,
  onPress,
}: {
  label: string;
  ok: boolean;
  pendingLabel?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.statusLine}>
      <View style={[styles.statusCheck, !ok && styles.statusCheckPending]}>
        <Ionicons
          name={ok ? 'checkmark' : 'ellipse-outline'}
          size={ok ? 14 : 12}
          color={ok ? colors.textInverse : colors.textMuted}
        />
      </View>
      <Text style={[styles.statusText, !ok && styles.statusTextPending]}>
        {ok ? label : pendingLabel ?? label}
      </Text>
      {!ok && onPress ? (
        <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
      ) : null}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} accessibilityRole="button">
        {content}
      </Pressable>
    );
  }
  return content;
}

// Fixed-height bottom sheet — a clean 60:40 split (map ~58% / sheet ~42%).
// Content scrolls inside so the SOS card stays at the top of the fold while
// the helpers row + status checklist are a flick away. Carries the peeking
// mascot + speech bubble at its top-right edge.
function BottomPanel({
  children,
  bottomInset,
}: {
  children: React.ReactNode;
  bottomInset: number;
}) {
  const screenHeight = Dimensions.get('window').height;
  // Taller now that the mascot peek is gone — the sheet owns the lower half.
  const SHEET_HEIGHT = Math.round(screenHeight * 0.5);

  return (
    <View style={[styles.bottomPanel, { height: SHEET_HEIGHT }]}>
      <View style={styles.handleZone}>
        <View style={styles.handle} />
      </View>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.panelContent,
          { paddingBottom: Math.max(bottomInset, 12) + 90 },
        ]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// Top floating header — avatar (→ Profile) on the left, gear (→ Settings)
// on the right, matching the reference.
function HomeHeader({
  profile,
  initial,
  unreadCount,
  onProfilePress,
  onSettingsPress,
  onNotificationsPress,
}: {
  profile: UserProfile | null;
  initial: string;
  unreadCount: number;
  onProfilePress: () => void;
  onSettingsPress: () => void;
  onNotificationsPress: () => void;
}) {
  const photo = profile?.photoUri ?? null;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open profile"
        hitSlop={8}
        onPress={onProfilePress}
        style={({ pressed }) => [styles.avatarWrap, pressed && styles.headerPressed]}
      >
        <View style={styles.avatar}>
          {photo ? (
            <Image source={{ uri: photo }} style={styles.avatarImage} />
          ) : initial ? (
            <Text style={styles.avatarInitial}>{initial}</Text>
          ) : (
            <Ionicons name="person" size={18} color={colors.textMuted} />
          )}
        </View>
      </Pressable>

      <View style={styles.headerRight}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          hitSlop={8}
          onPress={onNotificationsPress}
          style={({ pressed }) => [styles.gearWrap, pressed && styles.headerPressed]}
        >
          <Ionicons name="notifications-outline" size={20} color={colors.textPrimary} />
          {unreadCount > 0 ? <View style={styles.gearDot} /> : null}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={8}
          onPress={onSettingsPress}
          style={({ pressed }) => [styles.gearWrap, pressed && styles.headerPressed]}
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

// Always-visible "someone needs help" strip (only shown when alerts exist).
function AlertsStrip({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.alertsBanner} accessibilityRole="button">
      <View style={styles.alertsBadge}>
        <Text style={styles.alertsBadgeText}>{count}</Text>
      </View>
      <Text style={styles.alertsTitle} numberOfLines={1}>
        {count === 1 ? '1 person needs help nearby' : `${count} people need help nearby`}
      </Text>
      <Ionicons name="chevron-forward" size={16} color={colors.coral} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  headerFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  avatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadows.icon,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 18,
    color: colors.peachDeep,
  },
  headerPressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  gearWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  gearDot: {
    position: 'absolute',
    top: 11,
    right: 12,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.coral,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cream,
  },
  mapPlaceholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  mapDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#2D2924',
    zIndex: 1,
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    ...shadows.sheet,
    zIndex: 2,
  },
  mascotPeek: {
    position: 'absolute',
    top: -86,
    right: 20,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
    zIndex: 3,
  },
  speechBubble: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    marginBottom: 34,
    maxWidth: 140,
    ...shadows.icon,
  },
  speechText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDeep,
  },
  pressedScale: { transform: [{ scale: 0.97 }], opacity: 0.92 },
  panelContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: spacing.md,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.xs,
  },
  greetingHi: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  greetingSub: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 1,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  statusHeader: {
    flex: 1,
    marginBottom: spacing.xs,
  },
  safeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  safeDot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.sage,
  },
  safeLabel: {
    ...typography.label,
    color: colors.sageDeep,
  },
  allClear: {
    ...typography.displaySmall,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  helpersSub: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.sageSoft,
  },
  permissionText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 156,
  },
  voiceCard: {
    flex: 1,
    borderRadius: radius.xl,
    backgroundColor: colors.lavenderSoft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  voiceTitle: {
    ...typography.h3,
    color: colors.lavenderDeep,
  },
  voiceHint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  waveform: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: colors.lavender,
  },
  helpersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackAvatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2.5,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackAvatar: {
    width: 35,
    height: 35,
    borderRadius: 17.5,
    backgroundColor: colors.lavenderSoft,
  },
  stackAvatarEmpty: {
    backgroundColor: colors.lavenderSoft,
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 5.5,
    backgroundColor: colors.sage,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  helpersRowText: {
    flex: 1,
    marginLeft: spacing.md,
  },
  helpersRowTitle: {
    ...typography.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
  },
  helpersRowSub: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 1,
  },
  helpersRowChevron: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadows.card,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  statusCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusCheckPending: {
    backgroundColor: colors.creamDeep,
  },
  statusText: {
    ...typography.bodyMedium,
    fontSize: 15,
    color: colors.textPrimary,
    flex: 1,
  },
  statusTextPending: {
    color: colors.textSecondary,
  },
  statusDivider: {
    height: 1,
    backgroundColor: colors.divider,
  },
  alertsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.coralSoft,
  },
  alertsBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsBadgeText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 13,
    color: colors.textInverse,
  },
  alertsTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 14,
    color: colors.coralDeep,
    flex: 1,
  },

  /* ── premium glass cards + components ─────────────────── */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    ...shadows.card,
  },
  cardTitle: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15.5,
    color: colors.textPrimary,
  },
  cardSub: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
  },
  /* hero */
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  heroGlow: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.sage,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  heroSub: {
    ...typography.caption,
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: -1,
  },
  heroPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: spacing.sm,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
  },
  heroPillOn: {
    backgroundColor: colors.sageSoft,
  },
  heroPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textMuted,
  },
  heroPillDotOn: {
    backgroundColor: colors.sage,
  },
  heroPillText: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    color: colors.textMuted,
  },
  heroPillTextOn: {
    color: colors.sageDeep,
  },
  /* protection strength — slim pill */
  strengthPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
    ...shadows.card,
  },
  strengthTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  strengthIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strengthLabel: {
    flex: 1,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 13.5,
    color: colors.textPrimary,
  },
  strengthPct: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 14,
    letterSpacing: -0.3,
  },
  strengthBarTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDeep,
    marginTop: 9,
    overflow: 'hidden',
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  strengthStatus: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 11,
    marginTop: 5,
  },

  /* protection strength — bottom sheet */
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    ...shadows.sheet,
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.creamDeep,
    marginBottom: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 20,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  sheetStatus: {
    fontFamily: 'Poppins_500Medium',
    fontSize: 13,
    marginTop: 1,
  },
  sheetPct: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 30,
    letterSpacing: -0.5,
  },
  sheetBarTrack: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.creamDeep,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  sheetBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  sheetList: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
    ...shadows.card,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 13,
  },
  sheetRowIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetRowLabel: {
    flex: 1,
    fontFamily: 'Poppins_500Medium',
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  sheetRowDone: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12.5,
    color: colors.sageDeep,
  },
  sheetRowFix: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 12.5,
    color: colors.coralDeep,
  },
  sheetCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.coral,
  },
  sheetCtaDone: {
    backgroundColor: colors.sageSoft,
  },
  sheetCtaText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: colors.textInverse,
  },
  /* helpers */
  helpersCard: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  helpersTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.sageSoft,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  verifiedText: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 9.5,
    color: colors.sageDeep,
    letterSpacing: 0.2,
  },
});
