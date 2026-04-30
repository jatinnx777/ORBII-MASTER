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
import { OSMMapView, ScreenContainer, type OSMMarker } from '@/components/common';
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

// Marker HTML used by the home map. We hand-roll the icons so we can colour
// them by status (red user, yellow verified, green standard) and show a
// soft halo on the user's pin so it always pops against the OSM tiles.
function userPinHtml(): string {
  return `
    <div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:42px;height:42px;border-radius:21px;background:rgba(255,0,0,0.18);animation:halo 1.6s ease-out infinite;"></div>
      <div style="position:relative;width:18px;height:18px;border-radius:9px;background:#FF0000;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>
    </div>
    <style>@keyframes halo{0%{transform:scale(0.8);opacity:0.7}100%{transform:scale(1.6);opacity:0}}</style>
  `;
}

function helperPinHtml(verified: boolean): string {
  const color = verified ? '#FFD600' : '#00C853';
  const ring = verified ? '#B58F00' : '#00873E';
  return `
    <div style="width:18px;height:18px;border-radius:9px;background:${color};border:2.5px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);outline:1px solid ${ring};"></div>
  `;
}

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const { locationPermission, helpersNearby } = useAppSelector((s) => s.sos);
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
  const helperVerified = useAppSelector(
    (s) => s.helper.verification === 'verified' && s.helper.mode,
  );
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

  // Build the marker list for the map. Keep markers within MAP_RADIUS_KM of
  // the user so the map stays focused on their immediate neighbourhood.
  const mapMarkers: OSMMarker[] = useMemo(() => {
    const out: OSMMarker[] = [];
    if (currentLocation) {
      out.push({
        id: 'me',
        coordinate: currentLocation,
        html: userPinHtml(),
        kind: 'user',
      });
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
        html: helperPinHtml(!!peer.isVerified),
        kind: 'helper',
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
    <ScreenContainer padded={false} edges={['bottom', 'left', 'right']}>
      {currentLocation ? (
        <OSMMapView
          center={currentLocation}
          zoom={15}
          markers={mapMarkers}
          interactive
          showZoomControls={false}
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
          onProfilePress={() => navigation.navigate('Profile')}
          onFriendsPress={() => navigation.navigate('Friends')}
        />
      </View>

      <BottomPanel
        topRow={
          <View style={styles.panelTopRow}>
            <View style={styles.legendInline}>
              <LegendDot color={colors.primary} label="You" />
              <LegendDot color="#FFD600" label="Verified" />
              <LegendDot color={colors.success} label="Helpers" />
            </View>
            <Pressable
              onPress={handleSafeModePress}
              style={[
                styles.safeModeChip,
                !!safeJourney && styles.safeModeChipActive,
              ]}
              accessibilityRole="button"
              accessibilityLabel={
                safeJourney ? 'Safe Mode active' : 'Start Safe Mode'
              }
            >
              <Ionicons
                name={safeJourney ? 'shield-checkmark' : 'shield-outline'}
                size={14}
                color={safeJourney ? colors.textInverse : colors.textPrimary}
              />
              <Text
                style={[
                  styles.safeModeChipText,
                  !!safeJourney && { color: colors.textInverse },
                ]}
              >
                {safeJourney ? 'Safe Mode' : 'Safe Mode'}
              </Text>
            </Pressable>
          </View>
        }
      >
        {locationPermission !== 'granted' ? (
          <Pressable
            onPress={bootstrapPermission}
            style={styles.permissionBanner}
            accessibilityRole="button"
          >
            <Ionicons name="location" size={18} color={colors.primary} />
            <Text style={styles.permissionText}>
              Enable location for emergencies
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.primary} />
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
            onPress={() => navigation.navigate('HelperVerification')}
            style={styles.helperChipZero}
            accessibilityRole="button"
          >
            <View style={[styles.helperDot, styles.helperDotIdle]} />
            <Text style={styles.helperChipText}>0 helpers nearby ·</Text>
            <Text style={styles.helperChipCta}>Be the first</Text>
            <Ionicons name="arrow-forward" size={12} color={colors.primary} />
          </Pressable>
        )}

        <View style={styles.actionRow}>
          <SOSButton onPress={handleSOSPress} onLongPress={handleSOSLongPress} />
          <Pressable
            onPress={toggleListening}
            style={({ pressed }) => [
              styles.voiceCard,
              voiceListening && styles.voiceCardActive,
              pressed && { opacity: 0.9 },
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
      </BottomPanel>
    </ScreenContainer>
  );
}

// Draggable bottom panel with two snap points: expanded (full content
// visible) and collapsed (just the handle pokes up so the map fills the
// screen). Drag the handle area down to open the map, drag up to bring
// the controls back. Spring snap on release keeps it tactile.
function BottomPanel({
  children,
  topRow,
}: {
  children: React.ReactNode;
  topRow?: React.ReactNode;
}) {
  const screenHeight = Dimensions.get('window').height;
  // Panel takes ~58% of screen at full height. Collapsed = slid down by
  // COLLAPSE_OFFSET, leaving just the handle + alerts sliver visible.
  const COLLAPSE_OFFSET = Math.max(280, screenHeight * 0.42);
  // Default initial position is partly slid down (~30% of the way to
  // collapsed) so users see more map at first glance and can drag the
  // panel up for the action cards.
  const INITIAL_OFFSET = COLLAPSE_OFFSET * 0.3;
  const translateY = useRef(new Animated.Value(INITIAL_OFFSET)).current;
  const lastSnapRef = useRef(INITIAL_OFFSET);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
        onPanResponderGrant: () => {
          translateY.setOffset(lastSnapRef.current);
          translateY.setValue(0);
        },
        onPanResponderMove: (_, g) => {
          const next = Math.max(-20, Math.min(COLLAPSE_OFFSET + 20, g.dy));
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          translateY.flattenOffset();
          // Decide snap based on velocity + final position. Quick flicks
          // win over absolute position so the gesture feels responsive.
          const finalRaw = lastSnapRef.current + g.dy;
          let snap = finalRaw > COLLAPSE_OFFSET / 2 ? COLLAPSE_OFFSET : 0;
          if (g.vy > 0.6) snap = COLLAPSE_OFFSET;
          if (g.vy < -0.6) snap = 0;
          lastSnapRef.current = snap;
          Animated.spring(translateY, {
            toValue: snap,
            speed: 18,
            bounciness: 6,
            useNativeDriver: true,
          }).start();
        },
      }),
    [translateY, COLLAPSE_OFFSET],
  );

  return (
    <Animated.View
      style={[styles.bottomPanel, { transform: [{ translateY }] }]}
    >
      <View style={styles.handleZone} {...panResponder.panHandlers}>
        <View style={styles.handle} />
      </View>
      {topRow ? <View style={styles.panelTopRowWrap}>{topRow}</View> : null}
      <View style={styles.panelContent}>{children}</View>
    </Animated.View>
  );
}

// Avatar springs in on screen mount; chat icon fades in just after. Subtle
// motion on the header so the home doesn't pop into existence all at once.
function HomeHeader({
  profile,
  initial,
  onProfilePress,
  onFriendsPress,
}: {
  profile: UserProfile | null;
  initial: string;
  onProfilePress: () => void;
  onFriendsPress: () => void;
}) {
  const avatarScale = useRef(new Animated.Value(0.6)).current;
  const avatarOpacity = useRef(new Animated.Value(0)).current;
  const chatOpacity = useRef(new Animated.Value(0)).current;
  const chatTranslate = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(avatarScale, {
        toValue: 1,
        speed: 14,
        bounciness: 8,
        useNativeDriver: true,
      }),
      Animated.timing(avatarOpacity, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(120),
        Animated.parallel([
          Animated.timing(chatOpacity, {
            toValue: 1,
            duration: 260,
            useNativeDriver: true,
          }),
          Animated.timing(chatTranslate, {
            toValue: 0,
            duration: 280,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const photo = profile?.photoUri ?? null;

  return (
    <View style={styles.header}>
      <Animated.View
        style={{ opacity: avatarOpacity, transform: [{ scale: avatarScale }] }}
      >
        <Pressable
          style={styles.avatarWrap}
          accessibilityRole="button"
          accessibilityLabel="Open profile"
          hitSlop={8}
          onPress={onProfilePress}
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
      </Animated.View>
      <Animated.View
        style={{
          opacity: chatOpacity,
          transform: [{ translateY: chatTranslate }],
        }}
      >
        <Pressable
          style={styles.iconChip}
          accessibilityRole="button"
          accessibilityLabel="Friends"
          hitSlop={8}
          onPress={onFriendsPress}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={20}
            color={colors.textPrimary}
          />
        </Pressable>
      </Animated.View>
    </View>
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

// Always-visible "someone needs help" strip. Calm grey when no alerts;
// flips to red with a pulsing badge when one or more SOSs land within 2 km.
function AlertsStrip({ count, onPress }: { count: number; onPress: () => void }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const active = count > 0;

  useEffect(() => {
    if (!active) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <Pressable
      onPress={onPress}
      style={[styles.alertsBanner, !active && styles.alertsBannerIdle]}
      accessibilityRole="button"
    >
      <View style={[styles.alertsBadge, !active && styles.alertsBadgeIdle]}>
        {active ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFillObject,
              {
                borderRadius: 18,
                backgroundColor: 'rgba(255,255,255,0.35)',
                opacity: ringOpacity,
                transform: [{ scale: ringScale }],
              },
            ]}
          />
        ) : null}
        {active ? (
          <Text style={styles.alertsBadgeText}>{count}</Text>
        ) : (
          <Ionicons name="heart-outline" size={16} color={colors.textPrimary} />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.alertsTitle, !active && styles.alertsTitleIdle]}>
          {active
            ? count === 1
              ? 'Someone nearby needs help'
              : `${count} people nearby need help`
            : 'No alerts nearby'}
        </Text>
        <Text style={[styles.alertsMeta, !active && styles.alertsMetaIdle]}>
          {active
            ? 'Tap to respond, within 2 km'
            : "We'll buzz you the moment someone within 2 km fires SOS"}
        </Text>
      </View>
      <Ionicons
        name="chevron-forward"
        size={18}
        color={active ? colors.textInverse : colors.textMuted}
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
    borderRadius: 14,
    backgroundColor: colors.surface,
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
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.primary,
  },
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    ...shadows.sheet,
    elevation: 12,
  },
  handleZone: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.border,
  },
  panelContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  panelTopRowWrap: {
    paddingHorizontal: spacing.lg,
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
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  safeModeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  safeModeChipActive: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  safeModeChipText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  permissionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: '#FFF4F4',
    borderWidth: 1,
    borderColor: '#FFD3D3',
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
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  helperChipZero: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
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
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  helperChipCta: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.primary,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  voiceCard: {
    flex: 1,
    minHeight: 110,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 6,
  },
  voiceCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFF6F6',
  },
  voiceIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceIconActive: {
    backgroundColor: colors.primary,
  },
  voiceCardLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  voiceCardLabelActive: {
    color: colors.primary,
  },
  tinyPill: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  tinyPillActive: {
    backgroundColor: colors.primary,
  },
  tinyPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  tinyPillTextActive: {
    color: colors.textInverse,
  },
  alertsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    ...shadows.hero,
  },
  alertsBannerIdle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
  alertsBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertsBadgeIdle: {
    backgroundColor: colors.background,
  },
  alertsBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textInverse,
  },
  alertsTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
  },
  alertsTitleIdle: {
    color: colors.textPrimary,
  },
  alertsMeta: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 2,
    fontSize: 12,
  },
  alertsMetaIdle: {
    color: colors.textSecondary,
  },
});
