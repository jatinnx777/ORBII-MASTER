import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  Vibration,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SOSButton } from './components/SOSButton';
import { ScreenContainer } from '@/components/common';
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
import { silentSOSToggled } from '@/redux/slices/appSlice';
import {
  getCurrentLocation,
  getCurrentPermission,
  requestPermission,
} from '@/services/location';
import { countHelpersNearby } from '@/services/helpers';
import {
  alertFromBroadcast,
  countPresenceNearby,
  joinPresence,
  listNearbyAlerts,
  subscribePresence,
  subscribeToAlerts,
} from '@/services/community';
import { alertReceived, alertsLoaded } from '@/redux/slices/communitySlice';
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
import type { GeoPoint } from '@/types';

const HELPER_REFRESH_MS = 30_000;

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function HomeScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const { locationPermission, helpersNearby } = useAppSelector((s) => s.sos);
  const silentSOS = useAppSelector((s) => s.app.silentSOS);
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
  const nearbyAlerts = useAppSelector((s) => s.community.alerts);

  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const seenAlertIds = useRef<Set<string>>(new Set());
  const [voiceStatus, setVoiceStatus] = useState<VoiceDetectionStatus>('idle');

  // Subscription callback captures location via ref so we can subscribe once
  // on mount and never miss an alert while waiting for the GPS fix.
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
      // Helpers count = number of presence peers within 5km. The DB-backed
      // `countHelpersNearby` is kept as a fallback only — if the realtime
      // count is 0 we don't overwrite the presence count.
      const presenceCount = countPresenceNearby(point, profile?.uid ?? null, 5);
      dispatch(helpersNearbyUpdated(presenceCount));
      countHelpersNearby(point)
        .then((dbCount) => {
          if (dbCount > presenceCount) {
            dispatch(helpersNearbyUpdated(dbCount));
          }
        })
        .catch(() => undefined);
      // Backfill any active alerts (best-effort; merged with live broadcasts).
      const alerts = await listNearbyAlerts(point, 2, profile?.uid ?? null);
      dispatch(alertsLoaded(alerts));
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not read location.';
      dispatch(locationErrored(message));
    }
  }, [dispatch, profile?.uid]);

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

  // Ask for notification permission up-front so we can alert the user when
  // someone nearby triggers an SOS while they have the app backgrounded.
  useEffect(() => {
    requestNotificationPermission().catch(() => undefined);
  }, []);

  // Fire a local push whenever a new community alert appears within 2km
  // (i.e. an alert id we haven't shown a notification for yet).
  useEffect(() => {
    if (nearbyAlerts.length === 0) return;
    const fresh = nearbyAlerts.filter((a) => !seenAlertIds.current.has(a.id));
    if (fresh.length === 0) return;
    fresh.forEach((a) => {
      seenAlertIds.current.add(a.id);
      fireLocalNotification(
        'Someone nearby needs help',
        `${a.victim.name} · ${formatDistance(a.distanceMeters)} away. Tap to respond.`,
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

  // Realtime: listen for any SOS broadcast on the global channel. Subscribe
  // on mount unconditionally — we don't need the user's location to receive
  // alerts, only to compute distance. Previously we gated on currentLocation,
  // which meant the first alert after app launch was silently missed while
  // GPS was still being acquired.
  useEffect(() => {
    const sub = subscribeToAlerts((broadcast) => {
      const alert = alertFromBroadcast(
        broadcast,
        currentLocationRef.current,
        profileRef.current?.uid ?? null,
      );
      if (!alert) return;
      dispatch(alertReceived(alert));
      // Hard 3-second vibration so the responder notices even if the phone
      // is in a pocket. Pattern: 800ms buzz, 200ms gap, repeat. Plus a
      // synchronous heavy haptic up-front — Android's Vibration API takes
      // ~100ms to schedule, the haptic kicks in instantly.
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
        () => undefined,
      );
      Vibration.vibrate([0, 800, 200, 800, 200, 800, 200, 800]);
    });
    return () => sub.unsubscribe();
  }, [dispatch]);

  // Join presence channel so we appear as a "helper nearby" for everyone
  // else, and keep our entry's location fresh as the GPS updates.
  const presenceHandleRef = useRef<{
    update: (loc: GeoPoint) => void;
    leave: () => void;
  } | null>(null);
  useEffect(() => {
    if (!profile?.uid) return;
    presenceHandleRef.current = joinPresence({
      userId: profile.uid,
      name: profile.name ?? 'Someone',
      photoUri: profile.photoUri ?? null,
      location: currentLocation ?? null,
    });
    return () => {
      presenceHandleRef.current?.leave();
      presenceHandleRef.current = null;
    };
  }, [profile?.uid, profile?.name, profile?.photoUri]);

  useEffect(() => {
    if (currentLocation) presenceHandleRef.current?.update(currentLocation);
  }, [currentLocation]);

  // Re-count whenever the presence roster changes.
  useEffect(() => {
    const unsub = subscribePresence((peers) => {
      const me = profileRef.current?.uid ?? null;
      const here = currentLocationRef.current;
      if (!here) {
        // No GPS yet — show the raw count of online users (minus self).
        dispatch(
          helpersNearbyUpdated(
            peers.filter((p) => !me || p.userId !== me).length,
          ),
        );
        return;
      }
      const count = peers.filter((p) => {
        if (me && p.userId === me) return false;
        if (!p.location) return false;
        return haversineMeters(here, p.location) <= 5000;
      }).length;
      dispatch(helpersNearbyUpdated(count));
    });
    return unsub;
  }, [dispatch]);

  const handleSOSPress = () => {
    if (locationPermission !== 'granted') {
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
      return;
    }
    // Identity verification was previously gated here. Removed for the
    // current MVP — letting trusted-contact users send help is more
    // important than catching prank alerts when our verification backend
    // isn't wired yet. Re-add when Aadhaar/PAN verification is live.
    navigation.navigate('SOSCountdown');
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
        stopListening();
      };
    }, []),
  );

  const handleToggleSilent = () => {
    Haptics.selectionAsync().catch(() => undefined);
    dispatch(silentSOSToggled(!silentSOS));
    trackEvent('silent_sos_toggled', { enabled: !silentSOS });
  };

  const handleSafeModePress = () => {
    Haptics.selectionAsync().catch(() => undefined);
    if (safeJourney) {
      navigation.navigate('SafeJourneyActive');
    } else {
      navigation.navigate('SafeJourneyStart');
    }
  };

  const initial = (profile?.name ?? '').trim().charAt(0).toUpperCase();
  const greeting = getGreeting();
  const firstName = (profile?.name ?? '').trim().split(' ')[0] || 'there';

  return (
    <ScreenContainer padded={false}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>{greeting},</Text>
          <Text style={styles.nameLine}>{firstName}</Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            style={styles.iconChip}
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            hitSlop={8}
            onPress={() => navigation.navigate('Notifications')}
          >
            <Ionicons
              name="notifications-outline"
              size={20}
              color={colors.textPrimary}
            />
          </Pressable>
          <Pressable
            style={styles.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            hitSlop={8}
            onPress={() => navigation.navigate('Tabs', { screen: 'Profile' })}
          >
            <View style={styles.avatar}>
              {profile?.photoUri ? (
                <Image
                  source={{ uri: profile.photoUri }}
                  style={styles.avatarImage}
                />
              ) : initial ? (
                <Text style={styles.avatarInitial}>{initial}</Text>
              ) : (
                <Ionicons name="person" size={18} color={colors.textMuted} />
              )}
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.content}>
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

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <CountUp value={helpersNearby} style={styles.statValue} />
            <Text style={styles.statLabel}>Helpers nearby</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>
              {voiceStatus === 'listening' ? 'ON' : 'OFF'}
            </Text>
            <Text style={styles.statLabel}>Voice SOS</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statValue}>
              {safeJourney ? 'ON' : 'OFF'}
            </Text>
            <Text style={styles.statLabel}>Safe Mode</Text>
          </View>
        </View>

        <View style={styles.sosSection}>
          <SOSButton onPress={handleSOSPress} />
          <Text style={styles.sosHint}>
            {silentSOS ? 'Silent mode · discreet alert' : 'Tap for 5-second countdown'}
          </Text>
        </View>

        <Pressable onPress={toggleListening} style={styles.voiceRow}>
          <View
            style={[
              styles.voiceDot,
              voiceStatus === 'listening' && styles.voiceDotActive,
            ]}
          >
            <AudioWave active={voiceStatus === 'listening'} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.voiceTitle}>
              {voiceStatus === 'listening'
                ? 'Listening for "Help", "Bachao", "Madad"'
                : voiceStatus === 'starting' || voiceStatus === 'requesting-permission'
                  ? 'Starting voice detection…'
                  : 'Hands-free Voice SOS'}
            </Text>
            <Text style={styles.voiceMeta}>
              {voiceStatus === 'listening'
                ? 'Tap to stop'
                : 'Tap to start'}
            </Text>
          </View>
          <View
            style={[
              styles.pill,
              voiceStatus === 'listening' && styles.pillActive,
            ]}
          >
            <Text
              style={[
                styles.pillText,
                voiceStatus === 'listening' && styles.pillTextActive,
              ]}
            >
              {voiceStatus === 'listening' ? 'ON' : 'OFF'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.cardRow}>
          <Pressable
            onPress={handleToggleSilent}
            style={[styles.featureCard, silentSOS && styles.featureCardOnDark]}
          >
            <View style={styles.featureHead}>
              <Ionicons
                name={silentSOS ? 'eye-off' : 'eye-off-outline'}
                size={20}
                color={silentSOS ? colors.textInverse : colors.textPrimary}
              />
              <View
                style={[
                  styles.miniPill,
                  silentSOS && styles.miniPillOn,
                ]}
              >
                <Text
                  style={[
                    styles.miniPillText,
                    silentSOS && styles.miniPillTextOn,
                  ]}
                >
                  {silentSOS ? 'ON' : 'OFF'}
                </Text>
              </View>
            </View>
            <Text
              style={[
                styles.featureTitle,
                silentSOS && { color: colors.textInverse },
              ]}
            >
              Silent SOS
            </Text>
            <Text
              style={[
                styles.featureMeta,
                silentSOS && { color: 'rgba(255,255,255,0.7)' },
              ]}
            >
              Discreet alert
            </Text>
          </Pressable>

          <Pressable
            onPress={handleSafeModePress}
            style={[
              styles.featureCard,
              !!safeJourney && styles.featureCardOnGreen,
            ]}
          >
            <View style={styles.featureHead}>
              <Ionicons
                name={safeJourney ? 'shield-checkmark' : 'shield-outline'}
                size={20}
                color={safeJourney ? colors.textInverse : colors.textPrimary}
              />
              <View
                style={[
                  styles.miniPill,
                  !!safeJourney && styles.miniPillOnGreen,
                ]}
              >
                <Text
                  style={[
                    styles.miniPillText,
                    !!safeJourney && styles.miniPillTextOn,
                  ]}
                >
                  {safeJourney ? 'LIVE' : 'OFF'}
                </Text>
              </View>
            </View>
            <Text
              style={[
                styles.featureTitle,
                !!safeJourney && { color: colors.textInverse },
              ]}
            >
              Safe Mode
            </Text>
            <Text
              style={[
                styles.featureMeta,
                !!safeJourney && { color: 'rgba(255,255,255,0.85)' },
              ]}
            >
              {safeJourney ? safeJourney.label : 'Journey guard'}
            </Text>
          </Pressable>
        </View>

        {nearbyAlerts.length > 0 ? (
          <AlertsBanner
            count={nearbyAlerts.length}
            onPress={() => navigation.navigate('CommunityAlerts')}
          />
        ) : (
          <Pressable
            onPress={() => navigation.navigate('CommunityAlerts')}
            style={styles.communityQuiet}
            accessibilityRole="button"
          >
            <View style={styles.communityIcon}>
              <Ionicons name="heart-outline" size={16} color={colors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.communityQuietText}>Help someone nearby</Text>
              <Text style={styles.communityQuietMeta}>
                0 alerts · you'll be notified within 2km
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
    </ScreenContainer>
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Good night';
}

// Count-up text — interpolates between the previous value and the next over
// 600ms. Fast enough to feel responsive, slow enough that the eye notices
// the helpers count change.
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

// The community alerts banner. Slides up + fades in on first appearance, and
// the badge softly pulses to draw the eye without being alarming.
function AlertsBanner({ count, onPress }: { count: number; onPress: () => void }) {
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  useEffect(() => {
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
  }, [pulse]);

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });

  return (
    <Animated.View style={{ opacity: enter, transform: [{ translateY }] }}>
      <Pressable
        onPress={onPress}
        style={styles.alertsBanner}
        accessibilityRole="button"
      >
        <View style={styles.alertsBadge}>
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
          <Text style={styles.alertsBadgeText}>{count}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.alertsTitle}>
            {count === 1
              ? 'Someone nearby needs help'
              : `${count} people nearby need help`}
          </Text>
          <Text style={styles.alertsMeta}>Tap to respond · within 2km</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textInverse} />
      </Pressable>
    </Animated.View>
  );
}

function AudioWave({ active }: { active: boolean }) {
  const bars = useRef([0, 1, 2].map(() => new Animated.Value(0.4))).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((bar) => bar.setValue(0.3));
      return;
    }
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 380 + i * 90,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.3,
            duration: 380 + i * 70,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, bars]);

  return (
    <View style={waveStyles.row}>
      {bars.map((v, i) => (
        <Animated.View
          key={i}
          style={[
            waveStyles.bar,
            active && waveStyles.barActive,
            {
              height: v.interpolate({
                inputRange: [0, 1],
                outputRange: [4, 14],
              }),
            },
          ]}
        />
      ))}
    </View>
  );
}

const waveStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: 16,
  },
  bar: {
    width: 2.5,
    borderRadius: 2,
    backgroundColor: colors.textMuted,
  },
  barActive: {
    backgroundColor: colors.primary,
  },
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
  },
  greeting: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 13,
  },
  nameLine: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
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
    marginBottom: spacing.md,
  },
  permissionText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
    flex: 1,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  alertsBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    marginTop: spacing.sm,
    ...shadows.hero,
  },
  alertsBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
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
  alertsMeta: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.88)',
    marginTop: 2,
    fontSize: 12,
  },
  communityQuiet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.sm,
  },
  communityIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  communityQuietText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    color: colors.textPrimary,
    fontSize: 14,
  },
  communityQuietMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  sosSection: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  sosHint: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 13,
  },
  voiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  voiceDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  voiceDotActive: {
    backgroundColor: '#FFEAEA',
  },
  voiceTitle: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 14,
    color: colors.textPrimary,
  },
  voiceMeta: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  pillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  pillTextActive: {
    color: colors.textInverse,
  },
  cardRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  featureCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 10,
    minHeight: 104,
    justifyContent: 'space-between',
  },
  featureCardOnDark: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
    ...shadows.card,
  },
  featureCardOnGreen: {
    backgroundColor: colors.success,
    borderColor: colors.success,
    ...shadows.card,
  },
  featureHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  miniPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  miniPillOn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  miniPillOnGreen: {
    backgroundColor: 'rgba(255,255,255,0.22)',
  },
  miniPillText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    letterSpacing: 1,
    color: colors.textMuted,
  },
  miniPillTextOn: {
    color: colors.textInverse,
  },
  featureTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  featureMeta: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
  },
});
