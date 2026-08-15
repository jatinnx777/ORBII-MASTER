import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import {
  MLMapView,
  ScreenContainer,
  useBrandSheet,
} from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  ghostEnded,
  ghostLocationPinged,
  ghostStatusChanged,
} from '@/redux/slices/safetyModesSlice';
import { getCurrentLocation } from '@/services/location';
import type { AppStackParamList } from '@/navigation/types';
import type { MLMarker } from '@/components/common';

type Nav = NativeStackNavigationProp<AppStackParamList, 'GhostActive'>;

// Polling interval, every 30s while active. Cheap on battery and gives
// us a fresh "lastSeen" stamp so the map dot isn't stale.
const PING_MS = 30_000;
// If the user doesn't move >40m for this long, we flag a suspicious
// stop. Today's escalation is just a status flip; future versions
// surface the safety check sheet automatically.
const STILL_THRESHOLD_MS = 12 * 60_000;
const STILL_RADIUS_M = 40;

export function GhostActiveScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const sheet = useBrandSheet();
  const ghost = useAppSelector((s) => s.safetyModes.ghost);

  const lastMovedAt = useRef<number>(Date.now());
  const lastMovedPoint = useRef<{ lat: number; lng: number } | null>(null);

  // Poll loop. Gracefully no-ops if the user revoked location permission.
  useEffect(() => {
    if (!ghost.active) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const point = await getCurrentLocation();
        if (cancelled) return;
        const now = Date.now();
        dispatch(ghostLocationPinged({ point, at: now }));

        // Detect "still", same spot for STILL_THRESHOLD_MS triggers a
        // status flip to suspicious so the active screen pill changes.
        const last = lastMovedPoint.current;
        if (
          !last ||
          haversine(last.lat, last.lng, point.latitude, point.longitude) >
            STILL_RADIUS_M
        ) {
          lastMovedAt.current = now;
          lastMovedPoint.current = { lat: point.latitude, lng: point.longitude };
        } else if (now - lastMovedAt.current > STILL_THRESHOLD_MS) {
          dispatch(ghostStatusChanged('suspicious'));
        }
      } catch {
        // ignore, try again on next tick.
      }
    };
    tick();
    const id = setInterval(tick, PING_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [ghost.active, dispatch]);

  // Soft pulse on the status pill.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (!ghost.active) {
    setTimeout(() => navigation.goBack(), 0);
    return null;
  }

  const status =
    ghost.status === 'suspicious'
      ? { label: 'Possible long stop', tone: 'alert' as const }
      : ghost.status === 'reached'
        ? { label: 'Destination reached', tone: 'safe' as const }
        : { label: 'Quietly watching', tone: 'normal' as const };

  const center = ghost.lastSeen?.point ?? ghost.origin;
  const markers: MLMarker[] = [];
  if (ghost.lastSeen?.point) {
    markers.push({ id: 'me', coordinate: ghost.lastSeen.point, kind: 'user' });
  } else if (ghost.origin) {
    markers.push({ id: 'me', coordinate: ghost.origin, kind: 'user' });
  }

  const handleEnd = () => {
    sheet.confirm({
      title: 'End Ghost Mode?',
      body:
        'Your trip ends and your circle won\'t be alerted. End it once you\'re safe at your destination.',
      confirmLabel: 'End trip',
      cancelLabel: 'Keep watching',
      icon: 'shield-checkmark',
      onConfirm: () => {
        dispatch(ghostEnded());
        navigation.goBack();
      },
    });
  };

  const handleEscalate = () => {
    sheet.confirm({
      title: 'Alert your circle now?',
      body:
        'We\'ll send your circle your live location and your trip details. Use this when something feels off.',
      destructive: true,
      confirmLabel: 'Alert circle',
      cancelLabel: 'Not yet',
      icon: 'warning',
      onConfirm: () => {
        navigation.navigate('SOSCountdown');
      },
    });
  };

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 0] });

  return (
    <ScreenContainer padded={false} scroll={false}>
      <View style={styles.root}>
        <View style={styles.mapWrap}>
          {center ? (
            <MLMapView
              style={StyleSheet.absoluteFill}
              center={center}
              zoom={15}
              markers={markers}
              interactive
            />
          ) : (
            <View style={[StyleSheet.absoluteFill, styles.mapPlaceholder]} />
          )}
          <LinearGradient
            colors={['rgba(248,252,250,0.0)', 'rgba(248,252,250,0.85)']}
            style={styles.mapFade}
            pointerEvents="none"
          />
        </View>

        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
          >
            <Ionicons name="chevron-down" size={20} color={colors.textPrimary} />
          </Pressable>

          <View
            style={[
              styles.statusPill,
              status.tone === 'alert' && styles.statusPillAlert,
              status.tone === 'safe' && styles.statusPillSafe,
            ]}
          >
            <View style={styles.statusDotWrap}>
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.statusDotPulse,
                  status.tone === 'alert' && { backgroundColor: colors.warning },
                  { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
                ]}
              />
              <View
                style={[
                  styles.statusDot,
                  status.tone === 'alert' && { backgroundColor: colors.warning },
                ]}
              />
            </View>
            <Text
              style={[
                styles.statusText,
                status.tone === 'alert' && { color: colors.warning },
              ]}
            >
              {status.label}
            </Text>
          </View>

          <View style={{ width: 38 }} />
        </View>

        <View style={styles.footer}>
          <View style={styles.tripCard}>
            <View style={styles.tripIcon}>
              <Ionicons
                name="navigate-outline"
                size={18}
                color={colors.brandDeep}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.tripLabel}>HEADED TO</Text>
              <Text style={styles.tripDestination} numberOfLines={1}>
                {ghost.destinationLabel ?? 'Destination'}
              </Text>
              {ghost.cabNumber ? (
                <Text style={styles.tripMeta}>
                  Cab {ghost.cabNumber}
                  {ghost.driverName ? ` · ${ghost.driverName}` : ''}
                </Text>
              ) : null}
            </View>
          </View>

          {ghost.status === 'suspicious' ? (
            <View style={styles.suspiciousNote}>
              <Ionicons
                name="alert-circle-outline"
                size={16}
                color={colors.warning}
              />
              <Text style={styles.suspiciousText}>
                You haven't moved in a while. Tap "Everything okay?" if all is
                well, otherwise alert your circle.
              </Text>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              onPress={handleEscalate}
              style={({ pressed }) => [
                styles.alertBtn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="shield" size={15} color={colors.textInverse} />
              <Text style={styles.alertBtnText}>Alert circle</Text>
            </Pressable>
            <Pressable
              onPress={handleEnd}
              style={({ pressed }) => [
                styles.endBtn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="checkmark" size={15} color={colors.brandDeep} />
              <Text style={styles.endBtnText}>I'm safe</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ScreenContainer>
  );
}

function haversine(la1: number, lo1: number, la2: number, lo2: number): number {
  const R = 6_371_000;
  const dLat = ((la2 - la1) * Math.PI) / 180;
  const dLon = ((lo2 - lo1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((la1 * Math.PI) / 180) *
      Math.cos((la2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: {
    ...StyleSheet.absoluteFillObject,
  },
  mapPlaceholder: {
    backgroundColor: colors.surface,
  },
  mapFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 320,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: 'rgba(255,255,255,0.92)',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  statusPillAlert: {
    backgroundColor: '#FFF6E5',
  },
  statusPillSafe: {
    backgroundColor: colors.brandSoft,
  },
  statusDotWrap: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandDeep,
  },
  statusDotPulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.brandDeep,
  },
  statusText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.brandDeep,
    letterSpacing: 0.3,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  tripCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.background,
    borderRadius: 18,
    padding: 14,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 14,
    elevation: 4,
  },
  tripIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  tripDestination: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    marginTop: 1,
  },
  tripMeta: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  suspiciousNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFF6E5',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suspiciousText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: '#7A4D00',
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  alertBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.20,
    shadowRadius: 10,
    elevation: 4,
  },
  alertBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.textInverse,
    letterSpacing: 0.2,
  },
  endBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.brandMid,
  },
  endBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.brandDeep,
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
