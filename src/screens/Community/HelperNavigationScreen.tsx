import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { IconBadge, MLMapView, type MLMarker, type MLRoute } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { watchLocation, type LocationWatcher } from '@/services/location';
import { publishLiveLocation, type LiveLocationHandle } from '@/services/live-location';
import { fetchRoute } from '@/services/osrm';
import { haversineMeters, formatDistance } from '@/utils/geo';
import { trackEvent } from '@/services/analytics';
import { recordHelperResponse } from '@/services/helper-profile';
import type { AppStackParamList } from '@/navigation/types';
import type { GeoPoint } from '@/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;
type R = RouteProp<AppStackParamList, 'HelperNavigation'>;

function formatMins(durationSeconds: number): string {
  if (durationSeconds < 60) return 'Arriving';
  return `${Math.round(durationSeconds / 60)} min`;
}

export function HelperNavigationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { sosId, name, phone, lat, lng, photoUri } = route.params;
  const victim: GeoPoint = { latitude: lat, longitude: lng };

  const profile = useAppSelector((s) => s.user.profile);
  const startLoc = useAppSelector((s) => s.sos.currentLocation);
  const [me, setMe] = useState<GeoPoint | null>(startLoc);
  const [line, setLine] = useState<MLRoute | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [roadMeters, setRoadMeters] = useState<number | null>(null);
  const [announced, setAnnounced] = useState(false);

  const lastRouteFrom = useRef<GeoPoint | null>(null);
  const liveRef = useRef<LiveLocationHandle | null>(null);

  // Broadcast the helper's live position to the victim's SOS channel so they
  // see the helper approaching (and so "I've reached" can be confirmed).
  useEffect(() => {
    if (!profile) return;
    liveRef.current = publishLiveLocation(sosId, {
      id: profile.uid,
      name: profile.name ?? 'A helper',
      photoUri: profile.photoUri ?? null,
      phone: profile.phone ?? null,
    });
    return () => liveRef.current?.unsubscribe();
  }, [sosId, profile?.uid]);

  // Live-track the helper's position + publish each update.
  useEffect(() => {
    let watcher: LocationWatcher | null = null;
    watchLocation(
      (point) => {
        setMe(point);
        liveRef.current?.publish(point);
      },
      { distanceIntervalMeters: 8, timeIntervalMs: 4000 },
    ).then((w) => {
      watcher = w;
    });
    return () => watcher?.remove();
  }, []);

  // Recompute the route whenever the helper has moved enough.
  useEffect(() => {
    if (!me) return;
    const moved =
      !lastRouteFrom.current || haversineMeters(lastRouteFrom.current, me) > 25;
    if (!moved && line) return;
    lastRouteFrom.current = me;
    let cancelled = false;
    fetchRoute(me, victim).then((res) => {
      if (cancelled || !res) return;
      setLine({ geometry: res.geometry });
      setDurationSec(res.durationSeconds);
      setRoadMeters(res.distanceMeters);
    });
    return () => {
      cancelled = true;
    };
  }, [me]);

  const straightMeters = me ? haversineMeters(me, victim) : null;
  const distanceLabel = formatDistance(roadMeters ?? straightMeters ?? 0);
  const etaLabel = durationSec != null ? formatMins(durationSec) : '…';
  // Only let the helper confirm arrival once they're genuinely close (50 m).
  const within50 = (straightMeters ?? 9999) < 50;

  const markers: MLMarker[] = [
    { id: 'victim', coordinate: victim, kind: 'destination' },
    ...(me ? [{ id: 'me', coordinate: me, kind: 'user' as const }] : []),
  ];

  const handleCall = () => {
    if (phone) Linking.openURL(`tel:${phone}`).catch(() => undefined);
  };

  const handleArrived = () => {
    if (!within50 || announced) return;
    trackEvent('helper_arrived', { name });
    if (me) liveRef.current?.announceArrived(me);
    setAnnounced(true);
    // Count this as a completed response for the responder's recognition.
    void recordHelperResponse();
  };

  return (
    <View style={styles.root}>
      <MLMapView
        markers={markers}
        route={line}
        fitAll
        fitPadding={90}
        interactive
        style={StyleSheet.absoluteFill}
      />

      {/* top bar */}
      <SafeAreaView edges={['top']} style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable style={styles.roundBtn} onPress={() => navigation.popToTop()} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.etaPill}>
            <Ionicons name="navigate" size={14} color={colors.sageDeep} />
            <Text style={styles.etaPillText}>
              {etaLabel} · {distanceLabel}
            </Text>
          </View>
          <View style={styles.roundBtn} />
        </View>
      </SafeAreaView>

      {/* bottom card */}
      <SafeAreaView edges={['bottom']} style={styles.bottomSafe} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.victimRow}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatar} />
            ) : (
              <IconBadge icon="person" tint="coral" size={48} />
            )}
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.toLabel}>On your way to help</Text>
              <Text style={styles.victimName}>{name}</Text>
            </View>
            <Pressable style={styles.callBtn} onPress={handleCall} accessibilityRole="button">
              <Ionicons name="call" size={20} color={colors.textInverse} />
            </Pressable>
          </View>

          <View style={styles.metricsRow}>
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{etaLabel}</Text>
              <Text style={styles.metricLabel}>ETA</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{distanceLabel}</Text>
              <Text style={styles.metricLabel}>Distance</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metric}>
              <View style={[styles.liveDot, within50 && { backgroundColor: colors.sage }]} />
              <Text style={styles.metricLabel}>{within50 ? 'Close' : 'Live'}</Text>
            </View>
          </View>

          <Pressable
            onPress={handleArrived}
            disabled={!within50 || announced}
            style={({ pressed }) => [
              styles.arriveBtn,
              within50 && !announced && styles.arriveBtnReady,
              !within50 && { opacity: 0.55 },
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
          >
            <Ionicons
              name={announced ? 'time' : 'checkmark-circle'}
              size={18}
              color={within50 && !announced ? colors.textInverse : colors.textPrimary}
            />
            <Text
              style={[
                styles.arriveText,
                within50 && !announced && { color: colors.textInverse },
              ]}
            >
              {announced
                ? 'Waiting for them to confirm…'
                : within50
                  ? "I've reached"
                  : 'Get within 50m to confirm'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  topSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  roundBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  etaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    ...shadows.icon,
  },
  etaPillText: { ...typography.label, color: colors.textPrimary },
  bottomSafe: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  card: {
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.sheet,
  },
  victimRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.coralSoft },
  toLabel: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  victimName: { ...typography.h3, color: colors.textPrimary },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cream,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDivider: { width: 1, height: 28, backgroundColor: colors.divider },
  metricValue: { fontFamily: 'Poppins_700Bold', fontSize: 16, color: colors.textPrimary },
  metricLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral },
  arriveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.cream,
    borderRadius: radius.pill,
    paddingVertical: 15,
  },
  arriveBtnReady: { backgroundColor: colors.sage },
  arriveText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: colors.textPrimary },
});
