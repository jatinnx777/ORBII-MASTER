import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  Map as MLMap,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { ORBII_MAP_STYLE } from '@/components/common/mapStyle';
import {
  HIGH_SPEED_KMH,
  formatDuration,
  headingAt,
  positionAt,
  splitAt,
  type DriveEvent,
  type DriveTrip,
} from '@/services/replay';

/**
 * Replaying a journey on the map: the route, a marker that moves along it, and
 * the controls to scrub through it.
 *
 * THE MAP LAYER IS MAPLIBRE, NOT react-native-maps. Neither react-native-maps
 * nor @rnmapbox/maps is installed here and adding one would mean a second map
 * SDK in a 125MB APK, a native rebuild, and two different map implementations
 * to keep in step. @maplibre/maplibre-react-native is what every other map
 * screen in ORBII renders through, on OpenFreeMap vector tiles, and it does
 * everything below.
 *
 * WHAT IT DOES NOT SHOW, and this is a deliberate omission rather than a gap.
 * Hard braking, rapid acceleration and phone usage are the three chips that
 * make a drive summary look impressive, and ORBII cannot measure any of them.
 * Location is sampled once every 60 seconds or 40 metres, and braking is a one
 * to two second event, so a chip claiming it would be a guess dressed as a
 * measurement. Phone usage is not tracked anywhere in this product. The event
 * type is open, so if ORBII ever samples motion fast enough to see them they
 * slot in without a redesign. See services/replay.ts for the full reasoning.
 */

export type DriveReplayProps = {
  /** The journey to replay. Built by buildTrip() from the location trail. */
  trip: DriveTrip;
  /**
   * Events to pin on the route. Defaults to the trip's own derived events.
   *
   * Overridable so a caller can filter or supply its own, but ORBII only ever
   * passes events it can stand behind: a fast stretch and a long stop, both
   * derivable from the sampling rate this data actually has.
   */
  events?: DriveEvent[];
  /** Fires whenever the scrubber or playback moves, for a caller that wants to sync a list. */
  onSeek?: (at: number, index: number) => void;
  style?: StyleProp<ViewStyle>;
};

/**
 * Imperative handle, so a caller can drive the playhead without owning it.
 *
 * The alternative was making `t` a controlled prop, which would push a value
 * that changes on every animation frame up into the parent and re-render the
 * whole screen sixty times a second to move one marker. The playhead belongs
 * to this component; a parent only ever needs to point at a moment.
 */
export type DriveReplayHandle = {
  /** Jump to a moment. Pauses first, because a jump you have to fight is not a jump. */
  seekTo: (at: number) => void;
};

const SPEEDS = [1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** Playback minutes per real second at 1x. A 40 minute drive replays in about 40 seconds. */
const MINUTES_PER_SECOND = 60;

export const DriveReplay = forwardRef<DriveReplayHandle, DriveReplayProps>(function DriveReplay(
  { trip, events, onSeek, style },
  ref,
) {
  const shown = events ?? trip.events;

  const [t, setT] = useState(trip.startedAt);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<Speed>(1);
  const cameraRef = useRef<CameraRef>(null);

  // ---------------------------------------------------------------------
  // PLAYBACK
  // ---------------------------------------------------------------------
  // requestAnimationFrame rather than setInterval, and the difference is not
  // cosmetic. A 100ms interval advances the marker in ten visible steps a
  // second whatever the display is doing, and it keeps firing while the screen
  // is backgrounded, burning battery to animate something nobody is looking
  // at. rAF is paced by the display, so the motion is smooth at whatever
  // refresh rate the phone has, and the OS stops calling it when the app is
  // not visible. Nothing here has to remember to pause it.
  //
  // Every mutable part lives in a ref. Putting `t` in the dependency array
  // would tear down and rebuild the loop on every frame, which is the classic
  // way this pattern becomes the jank it was meant to remove.
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef(0);
  const rateRef = useRef<Speed>(rate);
  rateRef.current = rate;

  useEffect(() => {
    if (!playing) return;
    lastRef.current = Date.now();

    const step = () => {
      const now = Date.now();
      // Scaled by elapsed wall time, not by frame count, so a dropped frame
      // costs smoothness and never accuracy: the replay lasts the same number
      // of real seconds on a 60Hz phone and a 120Hz one.
      const delta = (now - lastRef.current) * rateRef.current * MINUTES_PER_SECOND;
      lastRef.current = now;
      setT((prev) => {
        const next = prev + delta;
        if (next >= trip.endedAt) {
          setPlaying(false);
          return trip.endedAt;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [playing, trip.endedAt]);

  // Belt and braces on unmount. The effect above already cancels on cleanup,
  // but a frame scheduled between the last cleanup and teardown would call
  // setT on a gone component.
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    },
    [],
  );

  // ---------------------------------------------------------------------
  // WHERE THE MARKER IS, AND WHICH WAY IT FACES
  // ---------------------------------------------------------------------
  const here = useMemo(() => positionAt(trip, t), [trip, t]);

  // Heading is held in a ref, not state, because it must SURVIVE the frames
  // where it cannot be computed. Two fixes closer than the GPS noise floor
  // have no honest direction between them, so headingAt returns the previous
  // one and the marker keeps pointing the way she was going while she waits at
  // a light, instead of snapping to north.
  const headingRef = useRef(0);
  headingRef.current = headingAt(trip, here.index, headingRef.current);

  useEffect(() => {
    onSeek?.(t, here.index);
  }, [t, here.index, onSeek]);

  useImperativeHandle(
    ref,
    () => ({
      seekTo: (at: number) => {
        setPlaying(false);
        const clamped = Math.max(trip.startedAt, Math.min(trip.endedAt, at));
        setT(clamped);
        // Fly the camera too. A jump that moves the playhead to somewhere off
        // screen has technically worked and visibly done nothing, which is how
        // tapping an event chip used to feel if the event was outside the
        // current view. The camera belongs to this component, so the flight
        // does too.
        const p = positionAt(trip, clamped);
        cameraRef.current?.flyTo({ center: [p.lng, p.lat], zoom: 16, duration: 600 });
      },
    }),
    [trip],
  );

  // ---------------------------------------------------------------------
  // THE ROUTE, SPLIT AT THE SCRUBBER
  // ---------------------------------------------------------------------
  // Three lines, in this order underneath the marker:
  //
  //   remaining   where she has yet to go on this replay, faint. Context, so
  //               the shape of the journey is legible before you play it.
  //   travelled   where the replay has reached, in the brand colour.
  //   fast        the legs that averaged above HIGH_SPEED_KMH, drawn over the
  //               travelled line so the information survives the split.
  //
  // The fast overlay stays because it is the only part of this that is a
  // measurement rather than a playhead. Dropping it to satisfy a two-line
  // design would remove the one honest signal the drive summary has.
  const geo = useMemo(() => {
    const { travelled, remaining } = splitAt(trip, t);
    const fastRuns: number[][][] = [];
    let run: number[][] = [];

    for (let i = 1; i <= here.index && i < trip.points.length; i++) {
      const a = trip.points[i - 1];
      const b = trip.points[i];
      if ((b.speedKmh ?? 0) >= HIGH_SPEED_KMH) {
        if (run.length === 0) run.push([a.lng, a.lat]);
        run.push([b.lng, b.lat]);
      } else if (run.length > 1) {
        fastRuns.push(run);
        run = [];
      } else {
        run = [];
      }
    }
    if (run.length > 1) fastRuns.push(run);

    return {
      travelled: lineFC(travelled.map((p) => [p.lng, p.lat])),
      remaining: lineFC(remaining.map((p) => [p.lng, p.lat])),
      fast: linesFC(fastRuns),
    };
  }, [trip, t, here.index]);

  // ---------------------------------------------------------------------
  // SCRUBBER
  // ---------------------------------------------------------------------
  // Hand-rolled rather than @react-native-community/slider, which is not a
  // dependency here and would be a native module and a rebuild for one
  // control. A PanResponder on a measured track is the whole implementation.
  const trackW = useRef(0);
  const seek = useCallback(
    (x: number) => {
      if (trackW.current <= 0) return;
      const f = Math.max(0, Math.min(1, x / trackW.current));
      setT(trip.startedAt + f * (trip.endedAt - trip.startedAt));
    },
    [trip.startedAt, trip.endedAt],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        // Touching the track pauses. Scrubbing while playback fights you for
        // the playhead is unusable, and a person who reaches for the scrubber
        // has already decided they want to steer.
        onPanResponderGrant: (e) => {
          setPlaying(false);
          seek(e.nativeEvent.locationX);
        },
        onPanResponderMove: (e, g) => seek(g.moveX - trackOriginRef.current),
      }),
    [seek],
  );
  const trackOriginRef = useRef(0);

  const progress =
    trip.endedAt > trip.startedAt
      ? (t - trip.startedAt) / (trip.endedAt - trip.startedAt)
      : 0;

  const first = trip.points[0];
  const last = trip.points[trip.points.length - 1];

  return (
    <View style={[s.root, style]}>
      <View style={s.mapWrap}>
        <MLMap
          style={StyleSheet.absoluteFill}
          mapStyle={ORBII_MAP_STYLE as never}
          logo={false}
          attribution={false}
          compass={false}
          touchRotate={false}
          touchPitch={false}
        >
          <Camera
            ref={cameraRef}
            initialViewState={{ center: [first.lng, first.lat], zoom: 14 }}
          />

          <GeoJSONSource id="dr-remaining" data={geo.remaining}>
            <Layer
              id="dr-remaining-line"
              type="line"
              paint={{ 'line-color': colors.textMuted, 'line-width': 4, 'line-opacity': 0.35 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>

          <GeoJSONSource id="dr-travelled" data={geo.travelled}>
            <Layer
              id="dr-travelled-casing"
              type="line"
              paint={{ 'line-color': '#1A1A1A', 'line-width': 8, 'line-opacity': 0.14 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
            <Layer
              id="dr-travelled-line"
              type="line"
              paint={{ 'line-color': colors.brandDeep, 'line-width': 4.5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>

          <GeoJSONSource id="dr-fast" data={geo.fast}>
            <Layer
              id="dr-fast-line"
              type="line"
              paint={{ 'line-color': colors.coralDeep, 'line-width': 5.5 }}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
            />
          </GeoJSONSource>

          <Marker lngLat={[first.lng, first.lat]} anchor="center">
            <View style={[s.pin, { backgroundColor: colors.sageDeep }]} />
          </Marker>
          <Marker lngLat={[last.lng, last.lat]} anchor="center">
            <View style={[s.pin, { backgroundColor: colors.textPrimary }]} />
          </Marker>

          {shown.map((e) => (
            <Marker key={e.id} lngLat={[e.lng, e.lat]} anchor="center">
              <View
                style={[
                  s.eventPin,
                  {
                    backgroundColor:
                      e.kind === 'high_speed' ? colors.coralDeep : colors.goldDeep,
                  },
                ]}
              >
                <Ionicons
                  name={e.kind === 'high_speed' ? 'speedometer' : 'pause'}
                  size={11}
                  color={colors.textInverse}
                />
              </View>
            </Marker>
          ))}

          {/* The playhead, rotated to the direction of travel. */}
          <Marker lngLat={[here.lng, here.lat]} anchor="center">
            <View style={s.puckRing}>
              <View style={[s.puckArrow, { transform: [{ rotate: `${headingRef.current}deg` }] }]}>
                <Ionicons name="navigate" size={13} color={colors.textInverse} />
              </View>
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

      <View style={s.controls}>
        <Pressable
          onPress={() => {
            // Replaying from the end should restart, not sit there doing
            // nothing, which is what a play button at 100% otherwise does.
            if (!playing && t >= trip.endedAt) setT(trip.startedAt);
            setPlaying((p) => !p);
          }}
          style={s.playBtn}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Play'}
        >
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={20}
            color={colors.textInverse}
            style={playing ? undefined : { marginLeft: 2 }}
          />
        </Pressable>

        <View style={s.trackCol}>
          <View
            style={s.track}
            onLayout={(e) => {
              trackW.current = e.nativeEvent.layout.width;
            }}
            // Absolute page X of the track's left edge, so a drag that leaves
            // the track still maps to the right position instead of jumping.
            ref={(node) => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (node as any)?.measure?.((_x: number, _y: number, _w: number, _h: number, px: number) => {
                trackOriginRef.current = px;
              });
            }}
            {...pan.panHandlers}
          >
            <View style={[s.trackFill, { width: `${Math.round(progress * 100)}%` }]} />
            <View style={[s.thumb, { left: `${Math.round(progress * 100)}%` }]} />
          </View>
          <View style={s.timeRow}>
            <Text style={s.time}>{formatDuration(t - trip.startedAt)}</Text>
            <Text style={s.time}>{formatDuration(trip.durationMs)}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => setRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length])}
          style={s.rateBtn}
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${rate} times`}
        >
          <Text style={s.rateText}>{rate}x</Text>
        </Pressable>
      </View>
    </View>
  );
});

// --- geojson helpers -------------------------------------------------------

// `as const` on every literal, matching TripReplayScreen. Without it TypeScript
// widens `type` to string and the object stops satisfying MapLibre's GeoJSON
// types, which is a confusing error for a correct object.
function linesFC(runs: number[][][]) {
  return {
    type: 'FeatureCollection' as const,
    features: runs
      .filter((r) => r.length > 1)
      .map((coords, i) => ({
        type: 'Feature' as const,
        id: i,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coords },
      })),
  };
}

// A one point line is not a line and MapLibre draws nothing for it. Routing
// through linesFC keeps the source valid at the very start of a replay, where
// travelled holds a single coordinate.
function lineFC(coords: number[][]) {
  return linesFC([coords]);
}

const s = StyleSheet.create({
  root: { flex: 1 },
  mapWrap: { flex: 1, overflow: 'hidden' },

  pin: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2.5,
    borderColor: colors.surface,
  },
  eventPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  puckRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(134,114,206,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  puckArrow: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },

  speedBadge: {
    position: 'absolute',
    top: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    alignItems: 'center',
  },
  speedNum: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 18,
    color: colors.textPrimary,
    // Digits change every frame during playback; without this the badge jitters
    // as the glyph widths change.
    fontVariant: ['tabular-nums'],
  },
  speedUnit: { fontFamily: fontFamilies.interRegular, fontSize: 10, color: colors.textSecondary },

  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trackCol: { flex: 1, gap: 6 },
  track: {
    height: 22,
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.brandDeep,
  },
  thumb: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    marginLeft: -7,
    backgroundColor: colors.surface,
    borderWidth: 3,
    borderColor: colors.brandDeep,
  },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  time: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },

  rateBtn: {
    minWidth: 40,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  rateText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
});

export default DriveReplay;
