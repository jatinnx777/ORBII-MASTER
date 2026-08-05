import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Image,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  MLMapView,
  type MLMapViewHandle,
  type AvatarMarker,
  type MLMarker,
  type MLRoute,
} from '@/components/common';
import { HelplinesCard } from '@/components/common';
import { PinPrompt } from '@/components/common';
import { appAlert } from '@/components/common';
import { submitArrivalCode } from '@/services/arrival-codes';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { startTracking, type TrackingSnapshot, type TrackingHandle, type AccuracyLevel } from '@/services/tracking';
import { interpolate, haversineMeters, formatDistance } from '@/utils/geo';
import { trackEvent } from '@/services/analytics';
import { recordHelperResponse } from '@/services/helper-profile';
import {
  RewardService,
  FraudDetectionService,
  createGeofence,
  createRouteVerifier,
  type Geofence,
  type RouteVerifier,
} from '@/services/rewards';
import type { AppStackParamList } from '@/navigation/types';
import type { GeoPoint } from '@/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;
type R = RouteProp<AppStackParamList, 'HelperNavigation'>;

const { height: SCREEN_H } = Dimensions.get('window');

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// Uber-style glide: smoothly eases a displayed point toward each new GPS
// target instead of letting the marker teleport. Confined to the memoized map
// so the rest of the screen isn't re-rendering at 30fps.
function useGlidePoint(target: GeoPoint | null, ms = 1200): GeoPoint | null {
  const [, force] = useState(0);
  const display = useRef<GeoPoint | null>(target);
  const from = useRef<GeoPoint | null>(target);
  const to = useRef<GeoPoint | null>(target);
  const start = useRef(0);
  const raf = useRef<number | null>(null);
  const lastPaint = useRef(0);

  useEffect(() => {
    if (!target) return;
    if (!display.current) {
      display.current = target;
      from.current = target;
      to.current = target;
      force((n) => n + 1);
      return;
    }
    from.current = display.current;
    to.current = target;
    start.current = Date.now();
    const tick = () => {
      const t = Math.min(1, (Date.now() - start.current) / ms);
      display.current = interpolate(from.current!, to.current!, easeOutCubic(t));
      const now = Date.now();
      if (now - lastPaint.current >= 28 || t >= 1) {
        lastPaint.current = now;
        force((n) => n + 1);
      }
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target?.latitude, target?.longitude, ms]);

  return display.current;
}

// The live map, isolated + memoized. Cameras follow both users; markers glide.
const LiveMap = memo(function LiveMap({
  helperTarget,
  victimTarget,
  route,
  victimName,
  victimPhoto,
}: {
  helperTarget: GeoPoint | null;
  victimTarget: GeoPoint;
  route: MLRoute | null;
  victimName: string;
  victimPhoto: string | null;
}) {
  const mapRef = useRef<MLMapViewHandle>(null);
  const glidedHelper = useGlidePoint(helperTarget, 1200);
  const glidedVictim = useGlidePoint(victimTarget, 1200);
  const lastFit = useRef(0);

  // Keep both visible with a smooth camera, throttled so it never jitters.
  useEffect(() => {
    if (!helperTarget) return;
    const now = Date.now();
    if (now - lastFit.current < 2500) return;
    lastFit.current = now;
    mapRef.current?.fitTo([helperTarget, victimTarget], 110);
  }, [helperTarget?.latitude, helperTarget?.longitude, victimTarget.latitude, victimTarget.longitude]);

  const markers: MLMarker[] = useMemo(
    () => (glidedHelper ? [{ id: 'me', coordinate: glidedHelper, kind: 'user' as const }] : []),
    [glidedHelper?.latitude, glidedHelper?.longitude],
  );
  const avatars: AvatarMarker[] = useMemo(
    () => [
      {
        id: 'victim',
        coordinate: glidedVictim ?? victimTarget,
        name: victimName,
        photoUri: victimPhoto,
      },
    ],
    [glidedVictim?.latitude, glidedVictim?.longitude, victimName, victimPhoto],
  );

  return (
    <MLMapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      markers={markers}
      avatarMarkers={avatars}
      route={route}
      center={helperTarget ?? victimTarget}
      zoom={15}
      interactive
    />
  );
});

const ACC_META: Record<AccuracyLevel, { label: string; color: string }> = {
  high: { label: 'High accuracy', color: colors.sageDeep },
  medium: { label: 'Medium accuracy', color: colors.goldDeep },
  approx: { label: 'Approximate', color: colors.coralDeep },
  unknown: { label: 'Locating…', color: colors.textMuted },
};

type TimelineEvent = { key: string; label: string; at: number; icon: keyof typeof Ionicons.glyphMap };

export function HelperNavigationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<R>();
  const { sosId, name, phone, lat, lng, photoUri, victimId, sosCreatedMs } = route.params;
  const victim: GeoPoint = useMemo(() => ({ latitude: lat, longitude: lng }), [lat, lng]);

  const profile = useAppSelector((s) => s.user.profile);
  const [snap, setSnap] = useState<TrackingSnapshot | null>(null);
  const [sharing, setSharing] = useState(true);
  const [announced, setAnnounced] = useState(false);
  const trackRef = useRef<TrackingHandle | null>(null);

  // ── Reward + fraud lifecycle (server-authoritative) ──
  // Open a rescue event on the server, then let the geofence decide arrival and
  // the route-verifier prove genuine travel. No manual tap ever pays anyone.
  const rewardEventId = useRef<string | null>(null);
  const geofence = useRef<Geofence | null>(null);
  const verifier = useRef<RouteVerifier>(createRouteVerifier());
  const lastMoveReport = useRef(0);
  useEffect(() => {
    if (!profile || !victimId) return;
    let alive = true;
    (async () => {
      const deviceId = await FraudDetectionService.getDeviceId();
      const { id: eventId, limitReached } = await RewardService.accept({
        sosId,
        victimId,
        sosCreatedIso: sosCreatedMs ? new Date(sosCreatedMs).toISOString() : null,
        deviceId,
        mockLocation: false,
      });
      if (!alive) return;
      if (limitReached) {
        appAlert(
          'Monthly help limit reached',
          "You've reached your help limit for this month. It resets on the 1st, and your limit grows as your Guardian level goes up.",
          [{ text: 'OK', onPress: () => navigation.goBack() }],
        );
        return;
      }
      if (!eventId) return;
      rewardEventId.current = eventId;
      geofence.current = createGeofence(victim, {
        onArrived: () => {
          void RewardService.geofenceArrival(eventId);
          void FraudDetectionService.reportFlags(eventId, verifier.current.flags());
        },
        onDepart: () => {
          void RewardService.depart(eventId);
        },
      });
    })();
    return () => {
      alive = false;
      // If the helper leaves the screen after arriving, finalise the reward.
      const id = rewardEventId.current;
      if (id && geofence.current?.hasArrived()) void RewardService.depart(id);
    };
  }, [sosId, victimId, sosCreatedMs, profile?.uid, victim]);

  // ── Tracking engine ──
  useEffect(() => {
    if (!profile) return;
    const handle = startTracking({
      sosId,
      responder: {
        id: profile.uid,
        name: profile.name ?? 'A helper',
        photoUri: profile.photoUri ?? null,
        phone: profile.phone ?? null,
      },
      victim,
      onSnapshot: setSnap,
    });
    trackRef.current = handle;
    return () => handle.stop();
  }, [sosId, profile?.uid, victim]);

  // Feed every fix into the fraud/route engine: accumulate snapped road metres,
  // run the geofence, and report movement to the server on a light throttle.
  const helperLat = snap?.helper?.latitude;
  const helperLng = snap?.helper?.longitude;
  useEffect(() => {
    const h = snap?.helper;
    const id = rewardEventId.current;
    if (!h || !id) return;
    const now = Date.now();
    verifier.current.add(h, now, snap?.route?.geometry.coordinates);
    geofence.current?.update(h, now);
    if (now - lastMoveReport.current > 15000) {
      lastMoveReport.current = now;
      void RewardService.reportMovement(id, verifier.current.roadMeters(), false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helperLat, helperLng]);

  // ── Timeline (events animate in as they happen) ──
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const nearbyFired = useRef(false);
  useEffect(() => {
    setEvents([
      { key: 'sos', label: 'SOS triggered', at: Date.now() - 60000, icon: 'alert-circle' },
      { key: 'accept', label: 'You accepted the request', at: Date.now(), icon: 'shield-checkmark' },
    ]);
  }, []);
  const straightMeters = snap?.straightMeters ?? null;
  useEffect(() => {
    if (!nearbyFired.current && straightMeters != null && straightMeters < 150) {
      nearbyFired.current = true;
      setEvents((e) => [...e, { key: 'near', label: 'You are nearby', at: Date.now(), icon: 'walk' }]);
    }
  }, [straightMeters]);

  const acc = ACC_META[snap?.accuracy ?? 'unknown'];
  const etaMin = snap?.etaSeconds != null ? Math.max(1, Math.round(snap.etaSeconds / 60)) : null;
  const etaText = snap?.etaSeconds != null && snap.etaSeconds < 60 ? 'Arriving now' : etaMin != null ? `Arriving in ${etaMin} min` : 'Finding the fastest route…';
  const distText = formatDistance(snap?.roadMeters ?? straightMeters ?? 0);
  const within50 = (straightMeters ?? 9999) < 50;
  const routeLine: MLRoute | null = snap?.route ?? null;

  const call = () => phone && Linking.openURL(`tel:${phone}`).catch(() => undefined);
  const message = () => phone && Linking.openURL(`sms:${phone}`).catch(() => undefined);
  const navigateExt = () => {
    const url = Platform.select({
      ios: `http://maps.apple.com/?daddr=${lat},${lng}`,
      default: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
    });
    if (url) Linking.openURL(url).catch(() => undefined);
  };
  const toggleShare = () => {
    const next = !sharing;
    setSharing(next);
    trackRef.current?.setShare(next);
  };
  // Completing a rescue is no longer a button the helper taps about himself.
  // He must be within 50 m AND type the 4-digit code that only the victim can
  // see — she reads it out once he's actually standing in front of her.
  const [codeOpen, setCodeOpen] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const openCodeEntry = () => {
    if (!within50 || announced) return;
    setCodeError(null);
    setCodeOpen(true);
  };

  const submitCode = async (code: string) => {
    // Submit YOUR code (verified helpers each have their own; everyone else
    // shares one) with your name. The victim's screen ticks you off, and the
    // SOS auto-closes once every helper's code is in.
    const res = await submitArrivalCode(sosId, code, profile?.name ?? 'A helper');
    if (res.ok) {
      setCodeOpen(false);
      setCodeError(null);
      trackEvent('helper_arrived', { name });
      trackRef.current?.markArrived();
      setAnnounced(true);
      setEvents((e) => [
        ...e,
        { key: 'arrived', label: 'Rescue completed', at: Date.now(), icon: 'checkmark-done-circle' },
      ]);
      void recordHelperResponse();
      return;
    }
    setCodeError(
      res.wrong
        ? 'That code is wrong. Ask them to read out your code again.'
        : res.error,
    );
  };

  return (
    <View style={styles.root}>
      <LiveMap
        helperTarget={snap?.helper ?? null}
        victimTarget={snap?.victim ?? victim}
        route={routeLine}
        victimName={name}
        victimPhoto={photoUri ?? null}
      />

      {/* ── Top: ETA + status ── */}
      <SafeAreaView edges={['top']} style={styles.topSafe} pointerEvents="box-none">
        <View style={styles.topRow}>
          <Pressable style={styles.roundBtn} onPress={() => navigation.popToTop()} hitSlop={10}>
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </Pressable>
          <View style={[styles.accChip, { borderColor: acc.color }]}>
            <View style={[styles.accDot, { backgroundColor: acc.color }]} />
            <Text style={[styles.accText, { color: acc.color }]}>
              {acc.label}{snap?.accuracyM != null ? ` · ${Math.round(snap.accuracyM)} m` : ''}
            </Text>
          </View>
          <View style={styles.roundBtn} />
        </View>

        <View style={styles.etaCard}>
          <Text style={styles.etaBig}>{etaText}</Text>
          <View style={styles.etaMetaRow}>
            <View style={styles.pulseDotSm} />
            <Text style={styles.etaMeta}>Emergency in progress</Text>
            <View style={styles.metaSep} />
            <Text style={styles.etaMeta}>{snap?.victimMoving ? 'Victim is moving' : 'Victim is stationary'}</Text>
          </View>
        </View>
      </SafeAreaView>

      {/* ── Bottom sheet ── */}
      <TrackingSheet
        name={name}
        photoUri={photoUri ?? null}
        etaText={etaMin != null ? `${etaMin} min` : '—'}
        distText={distText}
        moving={snap?.victimMoving ?? false}
        sharing={sharing}
        within50={within50}
        announced={announced}
        events={events}
        onCall={call}
        onMessage={message}
        onNavigate={navigateExt}
        onShare={toggleShare}
        onArrived={openCodeEntry}
      />

      {/* She reads the code out; he types it. Server-verified — he never sees
          it, so he cannot complete a rescue he did not attend. */}
      <PinPrompt
        visible={codeOpen}
        mode="verify"
        title="Enter her 4-digit code"
        body="Ask her to read out the code on her screen. This confirms you reached her."
        errorText={codeError}
        onCancel={() => {
          setCodeOpen(false);
          setCodeError(null);
        }}
        onSubmit={submitCode}
      />
    </View>
  );
}

// ── Draggable bottom sheet (two snap points, gesture-driven) ──
const PEEK = 268;
const EXPANDED = Math.min(SCREEN_H * 0.82, 640);

function TrackingSheet(props: {
  name: string;
  photoUri: string | null;
  etaText: string;
  distText: string;
  moving: boolean;
  sharing: boolean;
  within50: boolean;
  announced: boolean;
  events: TimelineEvent[];
  onCall: () => void;
  onMessage: () => void;
  onNavigate: () => void;
  onShare: () => void;
  onArrived: () => void;
}) {
  const collapsedY = EXPANDED - PEEK;
  const translateY = useRef(new Animated.Value(collapsedY)).current;
  const offset = useRef(collapsedY);

  const snapTo = useCallback(
    (to: number) => {
      offset.current = to;
      Animated.spring(translateY, {
        toValue: to,
        useNativeDriver: true,
        friction: 9,
        tension: 70,
      }).start();
    },
    [translateY],
  );

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderMove: (_e, g) => {
        const next = Math.max(0, Math.min(collapsedY, offset.current + g.dy));
        translateY.setValue(next);
      },
      onPanResponderRelease: (_e, g) => {
        const projected = offset.current + g.dy + g.vy * 90;
        snapTo(projected < collapsedY / 2 ? 0 : collapsedY);
      },
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, { height: EXPANDED, transform: [{ translateY }] }]}>
      <View {...pan.panHandlers} style={styles.grabZone}>
        <View style={styles.grabber} />
      </View>

      {/* Victim row */}
      <View style={styles.victimRow}>
        {props.photoUri ? (
          <Image source={{ uri: props.photoUri }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Text style={styles.avatarInitial}>{(props.name || '?').charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: spacing.md }}>
          <Text style={styles.toLabel}>You're helping</Text>
          <Text style={styles.victimName} numberOfLines={1}>{props.name}</Text>
        </View>
        <Pressable style={styles.callRound} onPress={props.onCall}>
          <Ionicons name="call" size={20} color={colors.textInverse} />
        </Pressable>
      </View>

      {/* Metrics */}
      <View style={styles.metrics}>
        <Metric value={props.etaText} label="ETA" />
        <View style={styles.metricDiv} />
        <Metric value={props.distText} label="Distance" />
        <View style={styles.metricDiv} />
        <Metric value={props.moving ? 'Moving' : 'Still'} label="Victim" tint={props.moving ? colors.sageDeep : colors.textSecondary} />
      </View>

      {/* Action buttons */}
      <View style={styles.actionsRow}>
        <Action icon="navigate" label="Navigate" onPress={props.onNavigate} />
        <Action icon="chatbubble-ellipses" label="Message" onPress={props.onMessage} />
        <Action
          icon={props.sharing ? 'location' : 'location-outline'}
          label={props.sharing ? 'Sharing' : 'Share'}
          onPress={props.onShare}
          active={props.sharing}
        />
      </View>

      {/* Helplines — the responder may need to call police / an ambulance to
          the scene, so the numbers are right here, not buried. */}
      <View style={{ marginTop: spacing.md }}>
        <HelplinesCard compact />
      </View>

      {/* Mark arrived */}
      <Pressable
        onPress={props.onArrived}
        disabled={!props.within50 || props.announced}
        style={[
          styles.arriveBtn,
          props.within50 && !props.announced && styles.arriveReady,
          !props.within50 && { opacity: 0.55 },
        ]}
      >
        <Ionicons
          name={props.announced ? 'checkmark-done-circle' : 'keypad'}
          size={18}
          color={props.within50 && !props.announced ? colors.textInverse : colors.textPrimary}
        />
        <Text style={[styles.arriveText, props.within50 && !props.announced && { color: colors.textInverse }]}>
          {props.announced
            ? 'Rescue completed'
            : props.within50
              ? 'Enter her 4-digit code'
              : 'Get within 50 m to complete'}
        </Text>
      </Pressable>

      {/* Timeline */}
      <Text style={styles.sectionLabel}>LIVE TIMELINE</Text>
      <View style={styles.timeline}>
        {props.events.map((e, i) => (
          <TimelineRow key={e.key} event={e} last={i === props.events.length - 1} />
        ))}
      </View>
    </Animated.View>
  );
}

function Metric({ value, label, tint }: { value: string; label: string; tint?: string }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, tint && { color: tint }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function Action({
  icon,
  label,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  active?: boolean;
}) {
  return (
    <Pressable style={styles.action} onPress={onPress}>
      <View style={[styles.actionIco, active && { backgroundColor: colors.sage }]}>
        <Ionicons name={icon} size={20} color={active ? colors.textInverse : colors.sageDeep} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

function TimelineRow({ event, last }: { event: TimelineEvent; last: boolean }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim]);
  return (
    <Animated.View
      style={[
        styles.tlRow,
        { opacity: anim, transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] }) }] },
      ]}
    >
      <View style={styles.tlLeft}>
        <View style={styles.tlDot}>
          <Ionicons name={event.icon} size={13} color={colors.textInverse} />
        </View>
        {!last ? <View style={styles.tlBar} /> : null}
      </View>
      <View style={styles.tlBody}>
        <Text style={styles.tlLabel}>{event.label}</Text>
        <Text style={styles.tlTime}>
          {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  topSafe: { position: 'absolute', top: 0, left: 0, right: 0 },
  topRow: {
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
  accChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    ...shadows.icon,
  },
  accDot: { width: 8, height: 8, borderRadius: 4 },
  accText: { fontFamily: fontFamilies.poppinsBold, fontSize: 12 },
  etaCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  etaBig: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  etaMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  pulseDotSm: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral },
  etaMeta: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary },
  metaSep: { width: 3, height: 3, borderRadius: 2, backgroundColor: colors.textMuted },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: spacing.lg,
    ...shadows.sheet,
  },
  grabZone: { alignItems: 'center', paddingVertical: 12 },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.creamDeep },

  victimRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.sageDeep },
  toLabel: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary },
  victimName: { fontFamily: fontFamilies.poppinsBold, fontSize: 19, color: colors.textPrimary },
  callRound: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.hero,
  },

  metrics: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.creamDeep,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.md,
  },
  metric: { flex: 1, alignItems: 'center', gap: 2 },
  metricDiv: { width: 1, height: 30, backgroundColor: colors.divider },
  metricValue: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  metricLabel: { fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.textMuted },

  actionsRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  action: { flex: 1, alignItems: 'center', gap: 7 },
  actionIco: {
    width: 54,
    height: 54,
    borderRadius: 20,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textPrimary },

  arriveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.pill,
    paddingVertical: 16,
    marginTop: spacing.md,
  },
  arriveReady: { backgroundColor: colors.sage, ...shadows.hero },
  arriveText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },

  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  timeline: { paddingBottom: spacing.xl },
  tlRow: { flexDirection: 'row', gap: spacing.md },
  tlLeft: { alignItems: 'center', width: 26 },
  tlDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tlBar: { width: 2, flex: 1, backgroundColor: colors.sageSoft, marginVertical: 2 },
  tlBody: { flex: 1, paddingBottom: spacing.md },
  tlLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textPrimary },
  tlTime: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, marginTop: 1 },
});
