import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
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
  Mascot,
  MascotLoader,
  MLMapView,
  ScreenContainer,
  type MLMarker,
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
  requestNotificationPermission,
} from '@/services/notifications';
import { formatDistance, haversineMeters } from '@/utils/geo';
import { trackEvent } from '@/services/analytics';
import { shouldDampenWork } from '@/services/battery-aware';
import { useNotificationsBadge } from '@/hooks/useNotificationsBadge';
import { useGuardianMessage, type GuardianContext } from '@/hooks/useGuardianMessage';
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
  const { locationPermission, helpersNearby } = useAppSelector((s) => s.sos);
  // `helperVerified` is the legacy gig-economy flag (cut). Circle members
  // are now the only "helpers" — every peer the user trusts is implicitly
  // verified by virtue of being in their circle.
  const helperVerified = false;
  const nearbyAlerts = useAppSelector((s) => s.community.alerts);

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
    Alert.alert(
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
        Alert.alert(
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
        Alert.alert(
          'Voice SOS needs a dev build',
          'Voice detection uses a native module that Expo Go cannot load.',
        );
      } else {
        Alert.alert('Could not start listening', result.reason ?? 'Unknown error');
      }
    }
  }, [voiceStatus]);

  useEffect(() => {
    const unsub = subscribeStatus(setVoiceStatus);
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = subscribeKeyword((keyword: VoiceKeyword, transcript: string) => {
      trackEvent('voice_trigger_fired', { keyword, transcript });
      navigation.navigate('SOSCountdown');
    });
    return unsub;
  }, [navigation]);

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
  const voiceListening = voiceStatus === 'listening' || voiceStatus === 'starting';
  const unreadCount = useNotificationsBadge();
  const contactsCount = profile?.emergencyContacts?.length ?? 0;

  const guardianContext: GuardianContext =
    locationPermission !== 'granted'
      ? 'permissionMissing'
      : contactsCount === 0
        ? 'contactsMissing'
        : voiceListening
          ? 'voiceReady'
          : 'safe';
  const guardianMessage = useGuardianMessage(guardianContext);

  // Build the marker list for the map. Keep markers within MAP_RADIUS_KM of
  // the user so the map stays focused on their immediate neighbourhood.
  const mapMarkers: MLMarker[] = useMemo(() => {
    const out: MLMarker[] = [];
    if (currentLocation) {
      out.push({ id: 'me', coordinate: currentLocation, kind: 'user' });
    }
    const here = currentLocation;
    presencePeers.forEach((peer) => {
      if (!peer.location) return;
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
  }, [currentLocation, presencePeers]);

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

  return (
    <ScreenContainer padded={false} edges={['left', 'right']}>
      {currentLocation ? (
        <MLMapView
          center={currentLocation}
          zoom={15}
          markers={mapMarkers}
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
        />
      </View>

      <BottomPanel bottomInset={insets.bottom} message={guardianMessage}>
        {/* status header */}
        <View style={styles.statusHeader}>
          <View style={styles.safeRow}>
            <View style={styles.safeDot} />
            <Text style={styles.safeLabel}>You’re Safe</Text>
          </View>
          <Text style={styles.allClear}>All Clear</Text>
          <Text style={styles.helpersSub}>
            {helpersScanState === 'scanning'
              ? 'Scanning your area…'
              : helpersNearby > 0
                ? `${helpersNearby} verified helper${helpersNearby === 1 ? '' : 's'} nearby`
                : 'No helpers nearby yet'}
          </Text>
        </View>

        <BatteryWarning />

        {locationPermission !== 'granted' ? (
          <Pressable
            onPress={bootstrapPermission}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="location" size={18} color={colors.sageDeep} />
            <Text style={styles.permissionText}>Enable location for emergencies</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.sageDeep} />
          </Pressable>
        ) : null}

        {/* SOS + Voice cards */}
        <View style={styles.actionRow}>
          <SOSButton onPress={handleSOSPress} onLongPress={handleSOSLongPress} />
          <VoiceCard listening={voiceListening} onPress={toggleListening} />
        </View>

        {/* helpers row */}
        <Pressable
          style={styles.helpersRow}
          onPress={() => navigation.navigate('Circles')}
          accessibilityRole="button"
        >
          <View style={styles.avatarStack}>
            {helperPhotos.length > 0
              ? helperPhotos.map((uri, i) => (
                  <Image
                    key={i}
                    source={{ uri }}
                    style={[styles.stackAvatar, { marginLeft: i === 0 ? 0 : -10 }]}
                  />
                ))
              : [0, 1, 2].map((i) => (
                  <View
                    key={i}
                    style={[
                      styles.stackAvatar,
                      styles.stackAvatarEmpty,
                      { marginLeft: i === 0 ? 0 : -10 },
                    ]}
                  >
                    <Ionicons name="person" size={14} color={colors.lavenderDeep} />
                  </View>
                ))}
          </View>
          <View style={styles.helpersRowText}>
            <Text style={styles.helpersRowTitle}>
              {helpersNearby > 0
                ? `${helpersNearby} Verified Helper${helpersNearby === 1 ? '' : 's'} Nearby`
                : 'Build your safety circle'}
            </Text>
            <Text style={styles.helpersRowSub}>
              {helpersNearby > 0 ? 'Tap to view' : 'Tap to invite someone'}
            </Text>
          </View>
          <View style={styles.helpersRowChevron}>
            <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
          </View>
        </Pressable>

        {/* guardian status checklist */}
        <View style={styles.statusCard}>
          <StatusLine
            label="Voice Detection Active"
            ok={voiceListening}
            pendingLabel="Turn on Voice Detection above"
          />
          <View style={styles.statusDivider} />
          <StatusLine
            label="Location Sharing Ready"
            ok={locationPermission === 'granted'}
            pendingLabel="Turn on Location Sharing above"
          />
          <View style={styles.statusDivider} />
          <StatusLine
            label="Emergency Contacts Connected"
            ok={contactsCount > 0}
            pendingLabel="Add an emergency contact"
            onPress={contactsCount > 0 ? undefined : () => navigation.navigate('EmergencyContacts')}
          />
        </View>

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
      <Text style={styles.voiceTitle}>Voice Trigger</Text>
      <Text style={styles.voiceHint}>{listening ? 'Listening…' : 'Listening Ready'}</Text>
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
  message,
}: {
  children: React.ReactNode;
  bottomInset: number;
  message: string;
}) {
  const screenHeight = Dimensions.get('window').height;
  const SHEET_HEIGHT = Math.round(screenHeight * 0.42);

  return (
    <View style={[styles.bottomPanel, { height: SHEET_HEIGHT }]}>
      {/* guardian peeking over (and holding onto) the sheet edge, with a
          speech bubble that points back at it */}
      <View style={styles.mascotPeek} pointerEvents="none">
        <View style={styles.speechBubble}>
          <Text style={styles.speechText}>{message}</Text>
          <View style={styles.speechTail} />
        </View>
        <Mascot pose="peek" size={86} />
      </View>

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
}: {
  profile: UserProfile | null;
  initial: string;
  unreadCount: number;
  onProfilePress: () => void;
  onSettingsPress: () => void;
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

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Settings"
        hitSlop={8}
        onPress={onSettingsPress}
        style={({ pressed }) => [styles.gearWrap, pressed && styles.headerPressed]}
      >
        <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        {unreadCount > 0 ? <View style={styles.gearDot} /> : null}
      </Pressable>
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
  avatarWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    width: 48,
    height: 48,
    borderRadius: 24,
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
    top: -76,
    right: 16,
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
    marginBottom: 18,
    maxWidth: 150,
    ...shadows.icon,
  },
  speechText: {
    ...typography.bodyMedium,
    fontSize: 12.5,
    lineHeight: 16,
    color: colors.textPrimary,
  },
  speechTail: {
    position: 'absolute',
    bottom: -4,
    right: 18,
    width: 12,
    height: 12,
    backgroundColor: colors.surface,
    transform: [{ rotate: '45deg' }],
    borderRadius: 2,
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
  statusHeader: {
    marginBottom: spacing.xs,
    // keep text clear of the peeking mascot at the sheet's top-right
    paddingRight: 96,
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
  stackAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.lavenderSoft,
  },
  stackAvatarEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
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
});
