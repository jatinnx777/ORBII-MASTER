import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  Marker,
  Map as MLMap,
  type CameraRef,
} from '@maplibre/maplibre-react-native';
import { colors, radius, shadows, spacing, weight } from '../theme';
import {
  describeLocation,
  getMemberLocation,
  type MemberLocation,
} from '../services/locations';

/**
 * Where she is, on a map, while the alarm is live.
 *
 * THE APP SHIPPED WITHOUT THIS. CircleAlert carried lat and lng from the very
 * first commit and nothing ever drew them. An app whose entire purpose is
 * answering an alarm could tell you an alarm had arrived and not where to go,
 * which is most of the job missing rather than a feature missing.
 *
 * MapLibre on OpenFreeMap tiles, the same stack the Android app uses. No key,
 * no billing account, and the two apps render the same world.
 *
 * IT REFRESHES, because a pin placed once is a pin that goes stale while
 * somebody drives to it. The position comes from circle_members_locations
 * rather than from the SOS row, because during an active SOS that view keeps
 * updating from her phone (sql/118) while the SOS row holds only where she was
 * when she raised it.
 */

const ORBII_MAP_STYLE = 'https://tiles.openfreemap.org/styles/bright';

/** How often to ask again. Fast enough to follow a moving person, slow enough to be free. */
const POLL_MS = 10000;

export function AlertMap({
  userId,
  fallback,
  name,
}: {
  userId: string;
  /** Where the SOS was raised. Drawn until a live position arrives, and it always does first. */
  fallback: { lat: number; lng: number };
  name: string;
}) {
  const [live, setLive] = useState<MemberLocation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cameraRef = useRef<CameraRef>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const m = await getMemberLocation(userId);
      if (!alive) return;
      setLive(m);
      setLoaded(true);
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [userId]);

  const point = live ? { lat: live.lat, lng: live.lng } : fallback;
  const status = live ? describeLocation(live) : null;

  // Follow her. Someone reading this screen is usually moving toward the pin,
  // and a map that stays where it was put makes them re-find her every minute.
  useEffect(() => {
    if (!live) return;
    cameraRef.current?.flyTo({ center: [live.lng, live.lat], duration: 900 });
  }, [live?.lat, live?.lng]);

  const openInMaps = () => {
    // Apple Maps on iOS, Google on Android. The label is the person, so the
    // destination reads as a name rather than a pair of coordinates.
    const q = `${point.lat},${point.lng}`;
    const url = Platform.select({
      ios: `maps://?q=${encodeURIComponent(name)}&ll=${q}`,
      default: `geo:${q}?q=${q}(${encodeURIComponent(name)})`,
    });
    void Linking.openURL(url as string).catch(() => {
      void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
    });
  };

  // A bubbled position is a CELL, not a point, and drawing it as a pin would
  // send somebody to the middle of a square kilometre believing it was exact.
  const bubble = live?.precisionM ?? null;

  return (
    <View style={s.wrap}>
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
          initialViewState={{ center: [point.lng, point.lat], zoom: bubble ? 12 : 15 }}
        />
        <Marker lngLat={[point.lng, point.lat]} anchor="center">
          <View style={[s.ring, bubble != null && s.ringSoft]}>
            <View style={s.dot} />
          </View>
        </Marker>
      </MLMap>

      {!loaded ? (
        <View style={s.loading} pointerEvents="none">
          <ActivityIndicator color={colors.brandDeep} />
        </View>
      ) : null}

      {status ? (
        <View style={[s.badge, status.loud && s.badgeLoud]} pointerEvents="none">
          <Text style={[s.badgeText, status.loud && s.badgeTextLoud]}>{status.text}</Text>
        </View>
      ) : null}

      {bubble != null ? (
        <View style={s.note} pointerEvents="none">
          <Text style={s.noteText}>
            {name} is sharing an approximate area, not an exact position. This pin is the centre
            of it.
          </Text>
        </View>
      ) : null}

      <Pressable onPress={openInMaps} style={s.cta} accessibilityRole="button">
        <Text style={s.ctaText}>Directions</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    height: 280,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.creamDeep,
  },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },

  ring: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(239,96,94,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Wider and paler when the position is a cell rather than a point, so the
  // marker itself says "somewhere around here".
  ringSoft: { backgroundColor: 'rgba(134,114,206,0.22)', width: 46, height: 46, borderRadius: 23 },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.coral,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
  },

  badge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    backgroundColor: '#FFFFFF',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    ...shadows.card,
  },
  badgeLoud: { backgroundColor: colors.coral },
  badgeText: { fontSize: 12, fontWeight: weight.semibold, color: colors.textPrimary },
  badgeTextLoud: { color: '#FFFFFF' },

  note: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: 56,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  noteText: { fontSize: 11.5, lineHeight: 16, color: colors.textSecondary },

  cta: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
  },
  ctaText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: weight.semibold },
});
