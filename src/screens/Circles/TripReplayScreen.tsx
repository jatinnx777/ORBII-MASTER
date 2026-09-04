import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  Map as MLMap,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { ORBII_MAP_STYLE } from '@/components/common/mapStyle';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import {
  HIGH_SPEED_KMH,
  formatDistance,
  formatDuration,
  loadTrip,
  positionAt,
  type DriveEvent,
  type DriveTrip,
} from '@/services/replay';

/**
 * Replaying a circle member's day on the map.
 *
 * WHAT THIS IS NOT. It is not a driving score. ORBII writes a location fix
 * every 60 seconds or 40 metres, which is enough to draw where somebody went
 * and roughly how fast, and nowhere near enough to see a brake pedal. Every
 * telemetry number on this screen is derived from that trail and says so, and
 * the events it can honestly detect are two: a fast stretch and a long stop.
 * See replay.ts for what was refused and why.
 *
 * WHY IT EXISTS AT ALL. A live dot tells you where somebody is. It does not
 * tell you whether they are okay. "Near the metro" is a walk home or it is
 * forty minutes of not moving at 11pm, and a dot cannot tell those apart. The
 * replay can.
 */

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** Real time per replay tick. 16ms would burn battery to move a dot 3 metres. */
const TICK_MS = 100;

export function TripReplayScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { userId, name } = (route.params ?? {}) as { userId: string; name?: string };

  const [trip, setTrip] = useState<DriveTrip | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<Speed>(1);

  const cameraRef = useRef<CameraRef>(null);
  // Measured on layout rather than assumed, so seeking stays correct on a
  // narrow screen and at large system font sizes.
  const trackW = useRef(0);

  useEffect(() => {
    let alive = true;
    void loadTrip(userId)
      .then((tr) => {
        if (!alive) return;
        setTrip(tr);
        setFailed(!tr);
        if (tr) setT(tr.startedAt);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFailed(true);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [userId]);

  // Playback. A wall-clock delta rather than a fixed increment per tick, so a
  // dropped frame loses time rather than desyncing the marker from the clock.
  const lastRef = useRef(0);
  useEffect(() => {
    if (!playing || !trip) return;
    lastRef.current = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const delta = (now - lastRef.current) * rate;
      lastRef.current = now;
      setT((prev) => {
        const next = prev + delta;
        if (next >= trip.endedAt) {
          setPlaying(false);
          return trip.endedAt;
        }
        return next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, rate, trip]);

  const here = useMemo(() => (trip ? positionAt(trip, t) : null), [trip, t]);

  // Two lines, not one gradient. MapLibre can interpolate a line's colour along
  // a gradient, but only on a source with lineMetrics, and the honest reading
  // of this data is binary anyway: a leg either averaged above the threshold or
  // it did not. A smooth gradient would imply a precision the 60 second sample
  // does not have.
  const lines = useMemo(() => {
    if (!trip) return { normal: emptyFC(), fast: emptyFC() };
    const normal: number[][][] = [];
    const fast: number[][][] = [];
    let run: number[][] = [];
    let runFast = false;

    for (let i = 1; i < trip.points.length; i++) {
      const a = trip.points[i - 1];
      const b = trip.points[i];
      const isFast = (b.speedKmh ?? 0) >= HIGH_SPEED_KMH;
      if (run.length === 0 || isFast !== runFast) {
        if (run.length > 1) (runFast ? fast : normal).push(run);
        run = [[a.lng, a.lat]];
        runFast = isFast;
      }
      run.push([b.lng, b.lat]);
    }
    if (run.length > 1) (runFast ? fast : normal).push(run);

    return { normal: linesFC(normal), fast: linesFC(fast) };
  }, [trip]);

  const jumpTo = useCallback((e: DriveEvent) => {
    Haptics.selectionAsync().catch(() => undefined);
    setPlaying(false);
    setT(e.at);
    cameraRef.current?.flyTo({ center: [e.lng, e.lat], zoom: 16, duration: 600 });
  }, []);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={colors.brandDeep} />
      </View>
    );
  }

  if (failed || !trip || !here) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
        <Header name={name} onBack={() => navigation.goBack()} />
        <View style={s.center}>
          <Ionicons name="map-outline" size={34} color={colors.textMuted} />
          <Text style={s.emptyTitle}>Nothing to replay</Text>
          <Text style={s.emptyText}>
            {name ?? 'They'} has not shared location today, or there are too few points to draw
            a route. Today&apos;s trail is deleted every midnight.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const progress = (t - trip.startedAt) / Math.max(1, trip.endedAt - trip.startedAt);

  return (
    <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}>
      <Header name={name} onBack={() => navigation.goBack()} />

      <View style={s.mapWrap}>
        <MLMap
          style={s.fill}
          mapStyle={ORBII_MAP_STYLE as never}
          logo={false}
          attribution={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{
              center: [trip.points[0].lng, trip.points[0].lat],
              zoom: 14,
            }}
          />

          <GeoJSONSource id="trip-normal" data={lines.normal}>
            <Layer
              id="trip-normal-casing"
              type="line"
              paint={{ 'line-color': '#1A1A1A', 'line-width': 8, 'line-opacity': 0.14 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <Layer
              id="trip-normal-line"
              type="line"
              paint={{ 'line-color': colors.brandDeep, 'line-width': 4.5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>

          <GeoJSONSource id="trip-fast" data={lines.fast}>
            <Layer
              id="trip-fast-line"
              type="line"
              paint={{ 'line-color': colors.coralDeep, 'line-width': 5.5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>

          <Marker lngLat={[trip.points[0].lng, trip.points[0].lat]} anchor="center">
            <View style={[s.pin, { backgroundColor: colors.sageDeep }]} />
          </Marker>
          <Marker
            lngLat={[
              trip.points[trip.points.length - 1].lng,
              trip.points[trip.points.length - 1].lat,
            ]}
            anchor="center"
          >
            <View style={[s.pin, { backgroundColor: colors.textPrimary }]} />
          </Marker>

          <Marker lngLat={[here.lng, here.lat]} anchor="center">
            <View style={s.puckRing}>
              <View style={s.puck} />
            </View>
          </Marker>
        </MLMap>

        <View style={s.speedBadge}>
          <Text style={s.speedNum}>
            {here.speedKmh === null ? '--' : Math.round(here.speedKmh)}
          </Text>
          <Text style={s.speedUnit}>km/h</Text>
        </View>
      </View>

      <View style={s.sheet}>
        <View style={s.scrubRow}>
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
              if (t >= trip.endedAt) setT(trip.startedAt);
              setPlaying((p) => !p);
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={playing ? 'Pause' : 'Play'}
            style={s.play}
          >
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={20}
              color={colors.textInverse}
              style={playing ? undefined : { marginLeft: 2 }}
            />
          </Pressable>

          <View
            style={s.track}
            onLayout={(e) => {
              trackW.current = e.nativeEvent.layout.width;
            }}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(e) => {
              setPlaying(false);
              seek(e.nativeEvent.locationX);
            }}
            onResponderMove={(e) => seek(e.nativeEvent.locationX)}
          >
            <View style={s.trackBg} />
            <View style={[s.trackFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} />
            {/* Events sit ON the scrubber, so the shape of the journey is
                visible without playing it. */}
            {trip.events.map((e) => (
              <View
                key={e.id}
                pointerEvents="none"
                style={[
                  s.tick,
                  {
                    left: `${
                      ((e.at - trip.startedAt) / Math.max(1, trip.endedAt - trip.startedAt)) * 100
                    }%`,
                    backgroundColor:
                      e.kind === 'high_speed' ? colors.coralDeep : colors.goldDeep,
                  },
                ]}
              />
            ))}
            <View
              pointerEvents="none"
              style={[s.knob, { left: `${Math.max(0, Math.min(1, progress)) * 100}%` }]}
            />
          </View>

          <Pressable
            onPress={() => {
              Haptics.selectionAsync().catch(() => undefined);
              setRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length]);
            }}
            hitSlop={10}
            style={s.rate}
          >
            <Text style={s.rateText}>{rate}x</Text>
          </Pressable>
        </View>

        <Text style={s.clock}>
          {clock(t)} <Text style={s.clockDim}>of {clock(trip.endedAt)}</Text>
        </Text>

        <View style={s.summary}>
          <Stat label="Distance" value={formatDistance(trip.distanceM)} />
          <Stat label="Duration" value={formatDuration(trip.durationMs)} />
          <Stat
            label="Average"
            value={trip.averageKmh === null ? '--' : `${Math.round(trip.averageKmh)} km/h`}
          />
          <Stat
            label="Fastest"
            value={trip.topSpeedKmh === null ? '--' : `${Math.round(trip.topSpeedKmh)} km/h`}
          />
        </View>

        {trip.events.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chips}
          >
            {trip.events.map((e) => (
              <Pressable key={e.id} onPress={() => jumpTo(e)} style={s.chip}>
                <View
                  style={[
                    s.chipDot,
                    {
                      backgroundColor:
                        e.kind === 'high_speed' ? colors.coralDeep : colors.goldDeep,
                    },
                  ]}
                />
                <View>
                  <Text style={s.chipTitle}>{e.label}</Text>
                  <Text style={s.chipDetail}>{e.detail}</Text>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
          <Text style={s.noEvents}>
            Nothing unusual on this route. ORBII only marks what a one minute location sample can
            actually show: a fast stretch, or a long stop.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );

  function seek(x: number) {
    // Measured lazily off the laid-out track rather than assumed, so it stays
    // correct on a small screen and at large system font sizes.
    const w = trackW.current || 1;
    const f = Math.max(0, Math.min(1, x / w));
    setT(trip!.startedAt + f * (trip!.endedAt - trip!.startedAt));
  }
}

function Header({ name, onBack }: { name?: string; onBack: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} hitSlop={12} style={s.back}>
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </Pressable>
      <View>
        <Text style={s.headerTitle}>{name ? `${name}'s day` : 'Replay'}</Text>
        <Text style={s.headerSub}>Today, deleted at midnight</Text>
      </View>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function emptyFC() {
  return { type: 'FeatureCollection' as const, features: [] };
}

function linesFC(runs: number[][][]) {
  return {
    type: 'FeatureCollection' as const,
    features: runs.map((coords, i) => ({
      type: 'Feature' as const,
      id: i,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: coords },
    })),
  };
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  fill: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.cream,
  },
  emptyTitle: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  headerSub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11.5,
    color: colors.textMuted,
    textAlign: 'center',
  },

  mapWrap: { flex: 1, overflow: 'hidden' },
  pin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  puckRing: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  puck: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.brandDeep,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },

  speedBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 74,
  },
  speedNum: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  speedUnit: { fontFamily: fontFamilies.interRegular, fontSize: 11, color: colors.textMuted },

  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },

  scrubRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1, height: 32, justifyContent: 'center' },
  trackBg: { height: 4, borderRadius: 2, backgroundColor: colors.creamDeep },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brandDeep,
  },
  tick: { position: 'absolute', width: 3, height: 12, borderRadius: 2, marginLeft: -1.5 },
  knob: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.brandDeep,
  },
  rate: {
    minWidth: 40,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
  },
  rateText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textPrimary },

  clock: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  clockDim: { fontFamily: fontFamilies.interRegular, color: colors.textMuted },

  summary: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', flex: 1 },
  statValue: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  statLabel: { fontFamily: fontFamilies.interRegular, fontSize: 11.5, color: colors.textMuted },

  chips: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cream,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  chipDetail: { fontFamily: fontFamilies.interRegular, fontSize: 11.5, color: colors.textSecondary },

  noEvents: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
  },
});
