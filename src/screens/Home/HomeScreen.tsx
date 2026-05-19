import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SOSButton } from './components/SOSButton';
import { CircleSelectorPill } from './components/CircleSelectorPill';
import {
  BatteryWarning,
  MLMapView,
  ScreenContainer,
  type MLMarker,
} from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
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
import { useSafetyTips } from '@/hooks/useSafetyTips';
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
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
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
      // Skip the ambient refresh when the phone is on low battery and
      // unplugged. The user can still press SOS — that's the critical
      // path and never dampened — but we save ~30 seconds of GPS / DB
      // chatter every cycle until they charge up.
      if (shouldDampenWork()) return;
      loadLocationAndHelpers();
    }, HELPER_REFRESH_MS);
    return () => {
      if (refreshTimer.current) clearInterval(refreshTimer.current);
    };
  }, [locationPermission, loadLocationAndHelpers]);

  // Alert subscription is now global (App.tsx) so the buzz fires on every
  // tab. We don't subscribe here anymore, just read alerts from the slice.

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

  const handleSafeModePress = () => {
    Haptics.selectionAsync().catch(() => undefined);
    if (safeJourney) {
      navigation.navigate('SafeJourneyActive');
    } else {
      navigation.navigate('SafeJourneyStart');
    }
  };

  const insets = useSafeAreaInsets();
  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase();
  const voiceListening = voiceStatus === 'listening' || voiceStatus === 'starting';
  const unreadCount = useNotificationsBadge();
  const safetyTips = useSafetyTips();
  const topTip = safetyTips[0] ?? null;

  const handleTipPress = useCallback(() => {
    if (!topTip) return;
    switch (topTip.target) {
      case 'enable_location':
        bootstrapPermission();
        return;
      case 'add_contact':
        navigation.navigate('EmergencyContacts');
        return;
      case 'invite_friend':
        navigation.navigate('Friends');
        return;
      case 'share_trip':
        navigation.navigate('SafeJourneyStart');
        return;
      case 'community_alerts':
        navigation.navigate('CommunityAlerts');
        return;
      case 'practice_sos':
        navigation.navigate('SOSCountdown', { test: true });
        return;
    }
  }, [topTip, bootstrapPermission, navigation]);

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
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.mapPlaceholderText}>Loading map…</Text>
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
          onProfilePress={() => navigation.navigate('Profile')}
          onNotificationsPress={() => navigation.navigate('Notifications')}
        />
      </View>

      <BottomPanel
        bottomInset={insets.bottom}
        topRow={
          <View style={styles.panelTopRow}>
            <View style={styles.legendInline}>
              <LegendDot color={colors.primary} label="You" />
              <LegendDot color={colors.brandDeep} label="Verified" />
              <LegendDot color={colors.brand} label="Helpers" />
            </View>
            <Pressable
              onPress={handleSafeModePress}
              style={({ pressed }) => [
                styles.safeModeChip,
                !!safeJourney && styles.safeModeChipActive,
                pressed && styles.pressedScale,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                safeJourney ? 'Safe Mode active' : 'Start Safe Mode'
              }
            >
              <Ionicons
                name={safeJourney ? 'shield-checkmark' : 'shield-outline'}
                size={14}
                color={safeJourney ? colors.textInverse : colors.brandDeep}
              />
              <Text
                style={[
                  styles.safeModeChipText,
                  !!safeJourney && { color: colors.textInverse },
                ]}
              >
                Safe Mode
              </Text>
            </Pressable>
          </View>
        }
      >
        <BatteryWarning />

        {locationPermission !== 'granted' ? (
          <Pressable
            onPress={bootstrapPermission}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="location" size={18} color={colors.brandDeep} />
            <Text style={styles.permissionText}>
              Enable location for emergencies
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.brandDeep} />
          </Pressable>
        ) : null}

        {helpersScanState === 'scanning' ? (
          <View style={styles.helperChip}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.helperChipText}>Scanning your area…</Text>
          </View>
        ) : helpersNearby > 0 ? (
          <View style={styles.helperChip}>
            <View style={styles.helperDot} />
            <CountUp value={helpersNearby} style={styles.helperChipNumber} />
            <Text style={styles.helperChipText}>
              within 5 km{verifiedCount > 0 ? ` · ${verifiedCount} verified` : ''}
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={() => navigation.navigate('Tabs', { screen: 'Circles' })}
            style={styles.helperChipZero}
            accessibilityRole="button"
          >
            <View style={[styles.helperDot, styles.helperDotIdle]} />
            <Text style={styles.helperChipText}>No circle members nearby ·</Text>
            <Text style={styles.helperChipCta}>Invite someone</Text>
            <Ionicons name="arrow-forward" size={12} color={colors.brandDeep} />
          </Pressable>
        )}

        <View style={styles.actionRow}>
          <SOSButton onPress={handleSOSPress} onLongPress={handleSOSLongPress} />
          <Pressable
            onPress={toggleListening}
            style={({ pressed }) => [
              styles.voiceCard,
              voiceListening && styles.voiceCardActive,
              pressed && styles.pressedScale,
            ]}
            accessibilityRole="button"
            accessibilityLabel={voiceListening ? 'Stop listening' : 'Start hands-free SOS'}
          >
            <View
              style={[
                styles.voiceIcon,
                voiceListening && styles.voiceIconActive,
              ]}
            >
              <Ionicons
                name={voiceListening ? 'mic' : 'mic-outline'}
                size={20}
                color={voiceListening ? colors.textInverse : colors.textPrimary}
              />
            </View>
            <Text
              style={[
                styles.voiceCardLabel,
                voiceListening && styles.voiceCardLabelActive,
              ]}
              numberOfLines={1}
            >
              Voice SOS
            </Text>
            <View
              style={[
                styles.tinyPill,
                voiceListening && styles.tinyPillActive,
              ]}
            >
              <Text
                style={[
                  styles.tinyPillText,
                  voiceListening && styles.tinyPillTextActive,
                ]}
              >
                {voiceListening ? 'LISTENING' : 'TAP TO START'}
              </Text>
            </View>
          </Pressable>
        </View>

        <AlertsStrip
          count={nearbyAlerts.length}
          onPress={() => navigation.navigate('CommunityAlerts')}
        />

        {topTip ? <SafetyTipCard tip={topTip} onPress={handleTipPress} /> : null}
      </BottomPanel>
    </ScreenContainer>
  );
}

// Draggable bottom sheet, two snap points (expanded / collapsed). Designed
// to feel grounded — top-only shadow, low radius, no glow. Map dims when
// expanded so the sheet reads as the active surface.
function BottomPanel({
  children,
  topRow,
  bottomInset,
}: {
  children: React.ReactNode;
  topRow?: React.ReactNode;
  bottomInset: number;
}) {
  const screenHeight = Dimensions.get('window').height;
  // Panel content + nav clearance is ~270px now; collapse to just the
  // handle peeking above the floating nav.
  const COLLAPSE_OFFSET = Math.max(240, screenHeight * 0.34);
  const translateY = useRef(new Animated.Value(0)).current;
  const lastSnapRef = useRef(0);

  // Map dim overlay: 1 (fully visible dim) when expanded → 0 when collapsed.
  // 0.10 max — enough that the bottom sheet reads as the active surface
  // without making the map feel "off".
  const dimOpacity = translateY.interpolate({
    inputRange: [0, COLLAPSE_OFFSET],
    outputRange: [0.10, 0],
    extrapolate: 'clamp',
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          translateY.setOffset(lastSnapRef.current);
          translateY.setValue(0);
        },
        onPanResponderMove: (_, g) => {
          // Resistance past snap points: rubber-band beyond the boundaries
          // so a hard pull feels like it's pushing against a stop.
          let next = g.dy;
          if (next < 0) next = next * 0.35;
          else if (next > COLLAPSE_OFFSET) {
            next = COLLAPSE_OFFSET + (next - COLLAPSE_OFFSET) * 0.35;
          }
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          translateY.flattenOffset();
          const finalRaw = lastSnapRef.current + g.dy;
          // Clamp velocity so a flick doesn't yeet the sheet past its
          // snap point with overshoot.
          const vy = Math.max(-1.6, Math.min(1.6, g.vy));
          let snap = finalRaw > COLLAPSE_OFFSET / 2 ? COLLAPSE_OFFSET : 0;
          if (vy > 0.5) snap = COLLAPSE_OFFSET;
          if (vy < -0.5) snap = 0;
          lastSnapRef.current = snap;
          Animated.spring(translateY, {
            toValue: snap,
            // Higher damping, lower overshoot — settles cleanly without
            // the bouncy "card" feel.
            damping: 28,
            stiffness: 240,
            mass: 1,
            velocity: vy,
            overshootClamping: false,
            restSpeedThreshold: 0.5,
            restDisplacementThreshold: 0.5,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateY, COLLAPSE_OFFSET],
  );

  return (
    <>
      <Animated.View
        pointerEvents="none"
        style={[styles.mapDim, { opacity: dimOpacity }]}
      />
      <Animated.View
        style={[
          styles.bottomPanel,
          {
            // Floating tab bar lives at bottom: max(insets.bottom, 12)
            // and is ~64px tall. Reserve that height + insets so the
            // alerts strip doesn't slip under the bar.
            paddingBottom: Math.max(bottomInset, 12) + 76,
            transform: [{ translateY }],
          },
        ]}
      >
        <View style={styles.handleZone} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>
        {topRow ? <View style={styles.panelTopRowWrap}>{topRow}</View> : null}
        <View style={styles.panelContent}>{children}</View>
      </Animated.View>
    </>
  );
}

// Top floating header — avatar (with online dot) on the left, circle
// selector pill in the centre (real circles from Supabase; empty state
// invites the user to create their first one), notification bell with
// unread dot on the right.
function HomeHeader({
  profile,
  initial,
  unreadCount,
  onProfilePress,
  onNotificationsPress,
}: {
  profile: UserProfile | null;
  initial: string;
  unreadCount: number;
  onProfilePress: () => void;
  onNotificationsPress: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const photo = profile?.photoUri ?? null;
  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [-6, 0],
  });

  return (
    <Animated.View
      style={[
        styles.header,
        { opacity: enter, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open profile"
        hitSlop={8}
        onPress={onProfilePress}
        style={({ pressed }) => [
          styles.avatarWrap,
          pressed && styles.headerPressed,
        ]}
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
        <View style={styles.avatarOnlineDot} />
      </Pressable>

      <CircleSelectorPill />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unreadCount > 0 ? `${unreadCount} new notifications` : 'Notifications'
        }
        hitSlop={8}
        onPress={onNotificationsPress}
        style={({ pressed }) => [
          styles.bellWrap,
          pressed && styles.headerPressed,
        ]}
      >
        <Ionicons
          name="notifications-outline"
          size={20}
          color={colors.textPrimary}
        />
        {unreadCount > 0 ? <View style={styles.bellDot} /> : null}
      </Pressable>
    </Animated.View>
  );
}

// Single dynamic safety tip surfaced based on real app state (no hardcoded
// copy — see `useSafetyTips`). Renders the top-priority tip with a calm
// mint-tinted card so it reads as a suggestion, not a warning.
function SafetyTipCard({
  tip,
  onPress,
}: {
  tip: ReturnType<typeof useSafetyTips>[number];
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tipCard,
        pressed && styles.pressedScale,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`${tip.title}. ${tip.cta}`}
    >
      <View style={styles.tipIcon}>
        <Ionicons name="sparkles" size={14} color={colors.brandDeep} />
      </View>
      <View style={styles.tipBody}>
        <Text style={styles.tipTitle} numberOfLines={1}>
          {tip.title}
        </Text>
        <Text style={styles.tipText} numberOfLines={2}>
          {tip.body}
        </Text>
      </View>
      <View style={styles.tipCta}>
        <Text style={styles.tipCtaText}>{tip.cta}</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.brandDeep} />
      </View>
    </Pressable>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={legendStyles.row}>
      <View style={[legendStyles.dot, { backgroundColor: color }]} />
      <Text style={legendStyles.text}>{label}</Text>
    </View>
  );
}

function CountUp({
  value,
  style,
}: {
  value: number;
  style: ReturnType<typeof StyleSheet.create>[string];
}) {
  const progress = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    const from = prevRef.current;
    progress.setValue(from);
    Animated.timing(progress, {
      toValue: value,
      duration: 600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    const id = progress.addListener(({ value: v }) => {
      setDisplay(Math.round(v));
    });
    prevRef.current = value;
    return () => progress.removeListener(id);
  }, [value, progress]);

  return <Text style={style}>{display}</Text>;
}

// Always-visible "someone needs help" strip. Solid colour switch — no
// glow / halo. The badge count makes it clear which state we're in.
function AlertsStrip({ count, onPress }: { count: number; onPress: () => void }) {
  const active = count > 0;

  return (
    <Pressable
      onPress={onPress}
      style={[styles.alertsBanner, !active && styles.alertsBannerIdle]}
      accessibilityRole="button"
    >
      <View style={[styles.alertsBadge, !active && styles.alertsBadgeIdle]}>
        {active ? (
          <Text style={styles.alertsBadgeText}>{count}</Text>
        ) : (
          <Ionicons name="heart-outline" size={14} color={colors.textPrimary} />
        )}
      </View>
      <Text
        style={[styles.alertsTitle, !active && styles.alertsTitleIdle]}
        numberOfLines={1}
      >
        {active
          ? count === 1
            ? '1 person needs help nearby'
            : `${count} people need help nearby`
          : 'No alerts nearby'}
      </Text>
      <Ionicons
        name="chevron-forward"
        size={16}
        color={active ? colors.primary : colors.textMuted}
      />
    </Pressable>
  );
}

const legendStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    ...typography.caption,
    color: colors.textPrimary,
    fontSize: 11,
  },
});

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
    paddingBottom: spacing.xs,
  },
  brandWrap: {
    flex: 1,
    alignItems: 'center',
  },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.primary,
    letterSpacing: 3,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.brandDeep,
  },
  avatarOnlineDot: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.background,
  },
  headerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.96 }],
  },
  bellWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  tipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tipBody: { flex: 1, gap: 2 },
  tipTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  tipText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11.5,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  tipCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tipCtaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11.5,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
  mapDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    zIndex: 1,
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    ...shadows.sheet,
    zIndex: 2,
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: 6,
    paddingBottom: 4,
  },
  handle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C9C9CE',
  },
  pressedScale: {
    transform: [{ scale: 0.97 }],
    opacity: 0.92,
  },
  panelContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  panelTopRowWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  panelTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  legendInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  safeModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.circle,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  safeModeChipActive: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
    // Subtle glow — the only halo effect on Home, reserved for the
    // signature protective state.
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 6,
  },
  safeModeChipText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  permissionText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  mapPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  mapPlaceholderText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  helperChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  helperChipZero: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  helperDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  helperDotIdle: {
    backgroundColor: colors.textMuted,
  },
  helperChipNumber: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  helperChipText: {
    fontFamily: fontFamilies.interMedium,
    color: colors.textSecondary,
    fontSize: 12,
  },
  helperChipCta: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.brandDeep,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  voiceCard: {
    flex: 1,
    minHeight: 72,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 10,
    ...shadows.card,
  },
  voiceCardActive: {
    borderColor: colors.brandDeep,
    backgroundColor: colors.brandSoft,
  },
  voiceIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceIconActive: {
    backgroundColor: colors.primary,
  },
  voiceCardLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
    letterSpacing: 0.3,
    flex: 1,
  },
  voiceCardLabelActive: {
    color: colors.primary,
  },
  tinyPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.circle,
    backgroundColor: colors.background,
  },
  tinyPillActive: {
    backgroundColor: colors.primary,
  },
  tinyPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    letterSpacing: 0.6,
    color: colors.textMuted,
  },
  tinyPillTextActive: {
    color: colors.textInverse,
  },
  // Active state — soft danger wash so the user immediately reads "someone
  // needs help" without the visual aggression of a black bar. Idle state
  // stays a calm surface card. Both share the premium 24px radius + soft
  // diffuse shadow from the design tokens.
  alertsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 77, 77, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 77, 0.25)',
  },
  alertsBannerIdle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  alertsBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsBadgeIdle: {
    backgroundColor: colors.brandSoft,
  },
  alertsBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textInverse,
  },
  alertsTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.primary,
    flex: 1,
  },
  alertsTitleIdle: {
    color: colors.textPrimary,
  },
});
