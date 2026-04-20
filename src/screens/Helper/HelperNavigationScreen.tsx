import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, OSMMapView } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { jobCompleted, jobStatusChanged } from '@/redux/slices/helperSlice';
import { trackEvent } from '@/services/analytics';
import { fetchRoute, pointAlongRoute, type Route, type RouteStep } from '@/services/routing';
import { formatDistance, formatEta, haversineMeters } from '@/utils/geo';
import { watchLocation, type LocationWatcher } from '@/services/location';
import { publishLiveLocation, type LiveLocationHandle } from '@/services/live-location';
import type { GeoPoint } from '@/types';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'HelperNavigation'>;

const TICK_MS = 800;
const PROGRESS_PER_TICK = 0.012;

export function HelperNavigationScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.helper.currentJob);
  const status = useAppSelector((s) => s.helper.jobStatus);
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const profile = useAppSelector((s) => s.user.profile);

  const origin = useRef<GeoPoint | null>(
    currentLocation ??
      (job
        ? {
            latitude: job.location.latitude - 0.008,
            longitude: job.location.longitude - 0.008,
          }
        : null),
  ).current;

  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [livePoint, setLivePoint] = useState<GeoPoint | null>(null);

  useEffect(() => {
    if (!origin || !job) return;
    const controller = new AbortController();
    fetchRoute(origin, job.location, controller.signal)
      .then((r) => {
        setRoute(r);
        trackEvent('route_fetched', {
          distance_m: Math.round(r.distanceMeters),
          duration_s: Math.round(r.durationSeconds),
          steps: r.steps.length,
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const msg = err instanceof Error ? err.message : 'routing failed';
        setRouteError(msg);
      });
    return () => controller.abort();
  }, [origin, job]);

  useEffect(() => {
    if (!route || status === 'arrived') return;
    const id = setInterval(() => {
      setProgress((p) => Math.min(1, p + PROGRESS_PER_TICK));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [route, status]);

  useEffect(() => {
    if (progress >= 1 && status === 'accepted') {
      dispatch(jobStatusChanged('arrived'));
      trackEvent('helper_arrived', { jobId: job?.id });
    }
  }, [progress, status, dispatch, job?.id]);

  // Real GPS takes priority over the simulated progress — if the device is
  // actually moving we publish that. The simulator still runs so the UI
  // works during testing without real motion.
  useEffect(() => {
    let watcher: LocationWatcher | null = null;
    let cancelled = false;
    watchLocation((p) => {
      if (cancelled) return;
      setLivePoint(p);
    }).then((w) => {
      if (cancelled) {
        w.remove();
        return;
      }
      watcher = w;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      watcher?.remove();
    };
  }, []);

  const currentPoint: GeoPoint | null = useMemo(() => {
    if (livePoint) return livePoint;
    if (!route) return origin;
    return pointAlongRoute(route.polyline, progress);
  }, [livePoint, route, progress, origin]);

  // Publish this responder's position on the SOS channel so the victim's
  // device can paint it on their map in real time (Swiggy-style).
  const publisherRef = useRef<LiveLocationHandle | null>(null);
  useEffect(() => {
    if (!job) return;
    const handle = publishLiveLocation(job.id, {
      id: profile?.uid ?? `anon_${Date.now()}`,
      name: profile?.name ?? 'Nearby helper',
      photoUri: profile?.photoUri ?? null,
      phone: profile?.phone ?? null,
    });
    publisherRef.current = handle;
    return () => {
      handle.unsubscribe();
      publisherRef.current = null;
    };
  }, [job, profile?.uid, profile?.name, profile?.photoUri, profile?.phone]);

  useEffect(() => {
    if (!currentPoint) return;
    publisherRef.current?.publish(currentPoint);
  }, [currentPoint]);

  const remainingMeters = route ? route.distanceMeters * (1 - progress) : 0;
  const remainingSeconds = route ? route.durationSeconds * (1 - progress) : 0;

  const currentStep: RouteStep | null = useMemo(() => {
    if (!route || !currentPoint || route.steps.length === 0) return null;
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < route.steps.length; i++) {
      const d = haversineMeters(currentPoint, route.steps[i].location);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const nextIdx = Math.min(bestIdx + 1, route.steps.length - 1);
    return route.steps[nextIdx] ?? route.steps[bestIdx];
  }, [route, currentPoint]);

  if (!job || !origin) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active job.</Text>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.emptyLink}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const handleResolved = () => {
    dispatch(jobCompleted({ reward: job.reward, lifeSaved: true }));
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  const handleCall = () => {
    Linking.openURL(`tel:${job.user.phone}`).catch(() => undefined);
  };

  const handleCancel = () => {
    Alert.alert(
      'Cancel this job?',
      'Your rating may drop if you cancel after accepting.',
      [
        { text: 'Keep going', style: 'cancel' },
        {
          text: 'Cancel',
          style: 'destructive',
          onPress: () => {
            dispatch(jobStatusChanged('declined'));
            navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
          },
        },
      ],
    );
  };

  const center: GeoPoint = currentPoint ?? origin;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <OSMMapView
        style={StyleSheet.absoluteFill}
        center={center}
        zoom={15}
        fitAll
        interactive={false}
        markers={[
          {
            id: 'you',
            coordinate: center,
            kind: 'user',
            pulse: true,
          },
          {
            id: 'dest',
            coordinate: job.location,
            kind: 'destination',
          },
        ]}
        polylines={
          route
            ? [
                {
                  id: 'route',
                  coordinates: route.polyline,
                  color: colors.primary,
                  width: 5,
                },
              ]
            : []
        }
      />

      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          {currentStep && status !== 'arrived' ? (
            <>
              <Text style={styles.stepInstruction} numberOfLines={1}>
                {currentStep.instruction}
              </Text>
              <Text style={styles.stepMeta}>
                {formatDistance(currentStep.distanceMeters)} · {job.user.name}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.userName}>{job.user.name}</Text>
              <Text style={styles.userMeta}>
                {route
                  ? job.location.address ?? 'Nearby'
                  : routeError
                    ? 'Routing unavailable'
                    : 'Finding the fastest route…'}
              </Text>
            </>
          )}
        </View>
        <Pressable
          style={styles.callBtn}
          onPress={handleCall}
          accessibilityRole="button"
          accessibilityLabel="Call user"
        >
          <Ionicons name="call" size={20} color={colors.textInverse} />
        </Pressable>
      </View>

      <View style={styles.sheet}>
        {!route && !routeError ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.sheetEta}>Calculating route…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.sheetDistance}>
              {status === 'arrived'
                ? 'You have arrived'
                : formatDistance(remainingMeters)}
            </Text>
            <Text style={styles.sheetEta}>
              {status === 'arrived'
                ? 'Confirm when you are with the user.'
                : `ETA ${formatEta(Math.round(remainingSeconds))}`}
            </Text>
          </>
        )}

        {status === 'arrived' ? (
          <Button label="I'm with the user" onPress={handleResolved} />
        ) : (
          <Button label="Cancel job" variant="outline" onPress={handleCancel} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    position: 'absolute',
    top: 52,
    left: spacing.md,
    right: spacing.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    ...shadows.card,
    zIndex: 2,
  },
  stepInstruction: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  stepMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  userName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
  },
  userMeta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  callBtn: {
    marginLeft: 'auto',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetDistance: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
  },
  sheetEta: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
  },
  emptyText: { ...typography.h3, color: colors.textPrimary },
  emptyLink: { ...typography.bodyMedium, color: colors.primary },
});
