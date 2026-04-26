import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  OSMMapView,
  useBrandSheet,
  type OSMMarker,
  type OSMPolyline,
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

type EmergencyLine = {
  id: string;
  label: string;
  number: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
};

const EMERGENCY_LINES: EmergencyLine[] = [
  { id: 'police', label: 'Police', number: '100', icon: 'shield', tint: '#1F6FEB' },
  { id: 'ambulance', label: 'Ambulance', number: '102', icon: 'medkit', tint: '#00A37A' },
  { id: 'sos', label: 'All-in-one', number: '112', icon: 'alert-circle', tint: '#E11D48' },
];

export function HelperNavigationScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.helper.currentJob);
  const status = useAppSelector((s) => s.helper.jobStatus);
  const currentLocation = useAppSelector((s) => s.sos.currentLocation);
  const profile = useAppSelector((s) => s.user.profile);
  const sheet = useBrandSheet();

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
  const [elapsed, setElapsed] = useState(0);

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

  useEffect(() => {
    if (status === 'arrived') return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [status]);

  useEffect(() => {
    let watcher: LocationWatcher | null = null;
    let cancelled = false;
    watchLocation((p) => {
      if (cancelled) return;
      setLivePoint(p);
    })
      .then((w) => {
        if (cancelled) {
          w.remove();
          return;
        }
        watcher = w;
      })
      .catch(() => undefined);
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

  const remainingMeters = route ? route.distanceMeters * (1 - progress) : 0;
  const remainingSeconds = route ? route.durationSeconds * (1 - progress) : 0;

  const handleResolved = () => {
    dispatch(jobCompleted({ reward: job.reward, lifeSaved: true }));
    navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
  };

  const handleCallVictim = () => {
    if (!job.user.phone) {
      sheet.notify({
        title: 'No number shared',
        body: 'This user has not shared a phone number.',
        tone: 'warning',
      });
      return;
    }
    Linking.openURL(`tel:${job.user.phone}`).catch(() => undefined);
  };

  const handleEmergencyCall = (line: EmergencyLine) => {
    sheet.confirm({
      title: `Call ${line.label} (${line.number})?`,
      body: 'Use this only if the situation is escalating beyond what you can handle alone.',
      cancelLabel: 'Not yet',
      confirmLabel: `Call ${line.number}`,
      destructive: true,
      icon: line.icon,
      onConfirm: () =>
        Linking.openURL(`tel:${line.number}`).catch(() => undefined),
    });
  };

  const handleCancel = () => {
    sheet.confirm({
      title: 'Cancel this job?',
      body: 'Your rating may drop if you cancel after accepting.',
      cancelLabel: 'Keep going',
      confirmLabel: 'Cancel',
      destructive: true,
      icon: 'close-circle',
      onConfirm: () => {
        dispatch(jobStatusChanged('declined'));
        navigation.reset({ index: 0, routes: [{ name: 'Tabs' }] });
      },
    });
  };

  const arrived = status === 'arrived';

  const center: GeoPoint = currentPoint ?? origin;

  const mapMarkers: OSMMarker[] = [
    {
      id: 'you',
      coordinate: center,
      html: helperPinHtml(),
      pulse: !arrived,
    },
    {
      id: 'dest',
      coordinate: job.location,
      html: victimPinHtml(),
      pulse: !arrived,
    },
  ];

  const mapPolylines: OSMPolyline[] = route
    ? [
        {
          id: 'route',
          coordinates: route.polyline,
          color: colors.dark,
          width: 4,
          dashed: true,
        },
      ]
    : [];

  const headerTitle = arrived
    ? "You're with the user"
    : remainingMeters < 80
      ? 'Almost at the victim'
      : 'Heading to the victim';
  const headerSub = arrived
    ? 'Confirm when you can see them'
    : 'Drive safe, share the road';
  const statusBannerText = arrived
    ? 'Help has arrived. Stay calm and assess.'
    : !route
      ? routeError ?? 'Calculating fastest route…'
      : remainingMeters < 200
        ? 'Less than 200 m away'
        : `ETA ${formatEta(Math.round(remainingSeconds))} · ${formatDistance(remainingMeters)}`;

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={handleCancel}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Cancel job"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.headerSub}>{headerSub}</Text>
            <Text style={styles.headerTitle}>{headerTitle}</Text>
          </View>
          <View style={styles.elapsedPill}>
            <View style={styles.liveDot} />
            <Text style={styles.elapsedText}>{formatElapsed(elapsed)}</Text>
          </View>
        </View>

        <View style={styles.statusBanner}>
          <Text style={styles.statusBannerText}>{statusBannerText}</Text>
        </View>

        <View style={styles.mapCard}>
          <OSMMapView
            style={styles.map}
            center={center}
            zoom={16}
            fitAll
            interactive={false}
            markers={mapMarkers}
            polylines={mapPolylines}
          />
        </View>

        <View style={styles.victimCard}>
          <VictimAvatar />
          <View style={{ flex: 1 }}>
            <Text style={styles.victimGreeting}>{job.user.name}</Text>
            <Text style={styles.victimRole}>needs your help</Text>
          </View>
          <Pressable
            onPress={handleCallVictim}
            style={styles.callBtn}
            accessibilityRole="button"
            accessibilityLabel="Call user"
          >
            <Ionicons name="call" size={18} color={colors.primary} />
          </Pressable>
        </View>

        {route ? (
          <View style={styles.tripStats}>
            <StatItem
              label="Distance left"
              value={arrived ? '0 m' : formatDistance(remainingMeters)}
            />
            <View style={styles.statDivider} />
            <StatItem
              label="ETA"
              value={
                arrived
                  ? 'Arrived'
                  : formatEta(Math.round(remainingSeconds))
              }
            />
            <View style={styles.statDivider} />
            <StatItem label="Reward" value={`₹${job.reward}`} />
          </View>
        ) : null}

        <LinearGradient
          colors={['#FFE4F0', '#E8D7FF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.escalateCard}
        >
          <View style={styles.escalateHead}>
            <Ionicons name="warning" size={18} color={colors.dark} />
            <Text style={styles.escalateTitle}>Need backup?</Text>
          </View>
          <Text style={styles.escalateBody}>
            If the situation looks serious, call the right line directly.
            ORBII has already alerted nearby helpers, you focus on safety.
          </Text>
          <View style={styles.escalateRow}>
            {EMERGENCY_LINES.map((line, idx) => (
              <EmergencyButton
                key={line.id}
                line={line}
                index={idx}
                onPress={() => handleEmergencyCall(line)}
              />
            ))}
          </View>
        </LinearGradient>

        {arrived ? (
          <Pressable
            onPress={handleResolved}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && { opacity: 0.9 },
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.textInverse} />
            <Text style={styles.primaryBtnText}>I'm with the user</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={handleCancel}
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="button"
          >
            <Ionicons name="close-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.cancelBtnText}>Cancel job</Text>
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

// Spring-scale entrance for each emergency button so the row reads as a
// quick cascade. Pressed-state scale gives tactile feedback when calling.
function EmergencyButton({
  line,
  index,
  onPress,
}: {
  line: EmergencyLine;
  index: number;
  onPress: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setTimeout(() => {
      Animated.spring(enter, {
        toValue: 1,
        speed: 14,
        bounciness: 8,
        useNativeDriver: true,
      }).start();
    }, 180 + index * 70);
    return () => clearTimeout(id);
  }, [enter, index]);

  const enterScale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] });

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity: enter,
        transform: [{ scale: Animated.multiply(enterScale, press) }],
      }}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(press, {
            toValue: 0.94,
            speed: 40,
            bounciness: 0,
            useNativeDriver: true,
          }).start()
        }
        onPressOut={() =>
          Animated.spring(press, {
            toValue: 1,
            speed: 30,
            bounciness: 8,
            useNativeDriver: true,
          }).start()
        }
        style={[styles.emergencyBtn, { borderColor: line.tint }]}
        accessibilityRole="button"
        accessibilityLabel={`Call ${line.label} on ${line.number}`}
      >
        <View style={[styles.emergencyIconWrap, { backgroundColor: line.tint + '22' }]}>
          <Ionicons name={line.icon} size={18} color={line.tint} />
        </View>
        <Text style={styles.emergencyNumber}>{line.number}</Text>
        <Text style={styles.emergencyLabel}>{line.label}</Text>
      </Pressable>
    </Animated.View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

// Stylised "cartoon" helper avatar, identical convention to the victim
// screen so users see the same red-shirt + black-helmet character whether
// they're requesting or responding.
function VictimAvatar() {
  return (
    <View style={avatarStyles.wrap}>
      <View style={avatarStyles.helmet} />
      <View style={avatarStyles.face} />
      <View style={avatarStyles.shirt} />
    </View>
  );
}

function helperPinHtml(): string {
  return `
    <div style="width:36px;height:36px;border-radius:18px;background:#1a1a1a;border:3px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.4);font-family:-apple-system,Roboto,sans-serif;font-size:14px;">
      <span>🛵</span>
    </div>
  `;
}

function victimPinHtml(): string {
  return `
    <div style="position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:42px;height:42px;border-radius:21px;background:rgba(255,0,0,0.18);"></div>
      <div style="position:relative;width:18px;height:18px;border-radius:9px;background:#FF0000;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>
    </div>
  `;
}

function formatElapsed(s: number): string {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

const avatarStyles = StyleSheet.create({
  wrap: {
    width: 56,
    height: 64,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  helmet: {
    position: 'absolute',
    top: 0,
    width: 36,
    height: 26,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#1a1a1a',
    zIndex: 2,
  },
  face: {
    position: 'absolute',
    top: 16,
    width: 28,
    height: 22,
    borderRadius: 6,
    backgroundColor: '#F4C28E',
    zIndex: 1,
  },
  shirt: {
    position: 'absolute',
    bottom: 0,
    width: 56,
    height: 30,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: colors.primary,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingTop: 56,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSub: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 12,
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  elapsedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary,
  },
  elapsedText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  statusBanner: {
    backgroundColor: '#FFEDD5',
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  statusBannerText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: '#B45309',
    letterSpacing: 0.2,
  },
  mapCard: {
    height: 240,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#E3E8EE',
    ...shadows.card,
  },
  map: {
    flex: 1,
  },
  victimCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.background,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.card,
  },
  victimGreeting: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  victimRole: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
  },
  callBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tripStats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  statLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
  },
  escalateCard: {
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  escalateHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  escalateTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  escalateBody: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 13,
  },
  escalateRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  emergencyBtn: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 4,
  },
  emergencyIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emergencyNumber: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textPrimary,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  emergencyLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.success,
    marginTop: spacing.sm,
  },
  primaryBtnText: {
    ...typography.button,
    color: colors.textInverse,
  },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.background,
    marginTop: spacing.sm,
  },
  cancelBtnText: {
    ...typography.button,
    color: colors.primary,
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

// Loading state utility no longer rendered explicitly; the status banner
// handles "calculating route" copy. Kept here in case future iterations
// want the standalone spinner row back.
function _LoadingRow() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <ActivityIndicator color={colors.primary} />
      <Text style={typography.body}>Calculating route…</Text>
    </View>
  );
}

// RouteStep currently unused since we render a single status banner instead
// of turn-by-turn instructions. Keeping the type import gates against the
// broader services/routing module changing shape silently.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _UnusedStepGuard = RouteStep;
