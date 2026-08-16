import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Marker,
  Map as MLMap,
  type CameraRef,
  type MapRef,
} from '@maplibre/maplibre-react-native';
import type { GeoPoint } from '@/types';
import { ORBII_MAP_STYLE } from './mapStyle';

// Avatar marker, a circle member shown on the map with their photo (or
// initial), Life360 style. Rendered as a MarkerView overlay so we can use a
// real profile image instead of a flat dot.
export type AvatarMarker = {
  id: string;
  coordinate: GeoPoint;
  photoUri: string | null;
  name: string;
};

// Native MapLibre wrapper used by Home + SOS. We keep the API small and
// mirror the shape of the previous OSMMapView so switching screens is a
// drop-in. Markers are rendered through a single GeoJSON source + circle
// layer (cheap; no per-marker view overhead). The route line is a separate
// LineLayer fed by the OSRM-returned GeoJSON.

// Custom ORBII green-and-cream theme, built on OpenFreeMap's free vector tiles
// (no API key, no rate limits). See mapStyle.ts. If it ever renders blank,
// swap `ORBII_MAP_STYLE` below for `FALLBACK_STYLE_URL`.

export type MLMarker = {
  id: string;
  coordinate: GeoPoint;
  // Visual category. Drives colour + size in the circle layer.
  kind?: 'user' | 'helper' | 'helper-verified' | 'destination';
};

export type MLRoute = {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
};

type Props = {
  center?: GeoPoint;
  zoom?: number;
  style?: StyleProp<ViewStyle>;
  markers?: MLMarker[];
  avatarMarkers?: AvatarMarker[];
  route?: MLRoute | null;
  // Fit camera to all markers (with padding). Wins over `center` when set.
  fitAll?: boolean;
  // Camera tracks user, flips on a built-in MapLibre tracking mode.
  followUser?: boolean;
  interactive?: boolean;
  // Padding when `fitAll` is on. Defaults to a comfortable safe-area value.
  fitPadding?: number;
};

export type MLMapViewHandle = {
  fitTo: (points: GeoPoint[], padding?: number) => void;
  flyTo: (point: GeoPoint, zoom?: number) => void;
};

// Pin palette. User is the universal "me" blue; helpers are ORBII sage
// (verified = deeper sage); destination is the emergency coral. No purples.
const COLOURS = {
  user: '#3B82F6',
  helper: '#7BC47F',
  'helper-verified': '#5BA85F',
  destination: '#EF605E',
} as const;

function toCoords(p: GeoPoint): [number, number] {
  return [p.longitude, p.latitude];
}

function markersToFeatureCollection(markers: MLMarker[]) {
  return {
    type: 'FeatureCollection' as const,
    features: markers.map((m) => ({
      type: 'Feature' as const,
      id: m.id,
      properties: { id: m.id, kind: m.kind ?? 'helper' },
      geometry: {
        type: 'Point' as const,
        coordinates: toCoords(m.coordinate),
      },
    })),
  };
}

function routeToFeature(route: MLRoute | null | undefined) {
  if (!route) {
    return { type: 'FeatureCollection' as const, features: [] };
  }
  return {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: {},
        geometry: route.geometry,
      },
    ],
  };
}

// Returns [west, south, east, north] for MapLibre fitBounds.
function bounds(points: GeoPoint[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;
  for (const p of points) {
    if (p.latitude < minLat) minLat = p.latitude;
    if (p.latitude > maxLat) maxLat = p.latitude;
    if (p.longitude < minLng) minLng = p.longitude;
    if (p.longitude > maxLng) maxLng = p.longitude;
  }
  return [minLng, minLat, maxLng, maxLat];
}

export const MLMapView = forwardRef<MLMapViewHandle, Props>(function MLMapView(
  {
    center,
    zoom = 15,
    style,
    markers = [],
    avatarMarkers = [],
    route,
    fitAll = false,
    followUser = false,
    interactive = true,
    fitPadding = 80,
  },
  ref,
) {
  const cameraRef = useRef<CameraRef>(null);
  const mapRef = useRef<MapRef>(null);

  // Pull the user out so it renders as a live pulsing dot, not a flat circle.
  const userMarker = useMemo(() => markers.find((m) => m.kind === 'user'), [markers]);
  const otherMarkers = useMemo(() => markers.filter((m) => m.kind !== 'user'), [markers]);
  const markerFC = useMemo(() => markersToFeatureCollection(otherMarkers), [otherMarkers]);
  const routeFC = useMemo(() => routeToFeature(route), [route]);

  // Auto-fit when fitAll is on and we have at least one marker.
  useEffect(() => {
    if (!fitAll) return;
    const points = [
      ...markers.map((m) => m.coordinate),
      ...avatarMarkers.map((m) => m.coordinate),
    ];
    if (points.length === 0) return;
    const b = bounds(points);
    if (!b) return;
    cameraRef.current?.fitBounds(b, {
      padding: {
        top: fitPadding,
        right: fitPadding,
        bottom: fitPadding,
        left: fitPadding,
      },
      duration: 600,
    });
  }, [fitAll, markers, fitPadding]);

  useImperativeHandle(
    ref,
    () => ({
      fitTo: (points: GeoPoint[], padding = fitPadding) => {
        const b = bounds(points);
        if (!b) return;
        cameraRef.current?.fitBounds(b, {
          padding: {
            top: padding,
            right: padding,
            bottom: padding,
            left: padding,
          },
          duration: 600,
        });
      },
      flyTo: (point: GeoPoint, z = zoom) => {
        cameraRef.current?.flyTo({
          center: toCoords(point),
          zoom: z,
          duration: 600,
        });
      },
    }),
    [fitPadding, zoom],
  );

  return (
    <MLMap
      ref={mapRef}
      style={[styles.fill, style]}
      // Cast: the runtime object is a valid MapLibre style, but the lib's
      // StyleSpecification type uses strict literal unions our plain object
      // doesn't satisfy structurally.
      mapStyle={ORBII_MAP_STYLE as never}
      logo={false}
      attribution={false}
      compass={false}
      dragPan={interactive}
      touchZoom={interactive}
      doubleTapZoom={interactive}
      touchRotate={false}
      touchPitch={false}
    >
      <Camera
        ref={cameraRef}
        initialViewState={
          center
            ? { center: toCoords(center), zoom }
            : { zoom }
        }
        trackUserLocation={followUser ? 'default' : undefined}
      />

      {route ? (
        <GeoJSONSource id="route-src" data={routeFC}>
          <Layer
            id="route-casing"
            type="line"
            paint={{
              'line-color': '#1A1A1A',
              'line-width': 7,
              'line-opacity': 0.18,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
          <Layer
            id="route-line"
            type="line"
            paint={{
              'line-color': '#2E9E5B',
              'line-width': 4.5,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </GeoJSONSource>
      ) : null}

      {otherMarkers.length > 0 ? (
        <GeoJSONSource id="markers-src" data={markerFC}>
          <Layer
            id="markers-halo"
            type="circle"
            paint={{
              'circle-radius': [
                'match',
                ['get', 'kind'],
                'user',
                14,
                'destination',
                14,
                10,
              ],
              'circle-color': [
                'match',
                ['get', 'kind'],
                'user',
                COLOURS.user,
                'helper-verified',
                COLOURS['helper-verified'],
                'destination',
                COLOURS.destination,
                COLOURS.helper,
              ],
              'circle-opacity': 0.18,
            }}
          />
          <Layer
            id="markers-fill"
            type="circle"
            paint={{
              'circle-radius': [
                'match',
                ['get', 'kind'],
                'user',
                7,
                'destination',
                8,
                6,
              ],
              'circle-color': [
                'match',
                ['get', 'kind'],
                'user',
                COLOURS.user,
                'helper-verified',
                COLOURS['helper-verified'],
                'destination',
                COLOURS.destination,
                COLOURS.helper,
              ],
              'circle-stroke-color': '#FFFFFF',
              'circle-stroke-width': 2.5,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {userMarker ? (
        <Marker lngLat={toCoords(userMarker.coordinate)} anchor="center">
          <UserDot />
        </Marker>
      ) : null}

      {avatarMarkers.map((m) => (
        <Marker key={m.id} lngLat={toCoords(m.coordinate)} anchor="bottom">
          <View style={styles.avatarPin}>
            <View style={styles.avatarRing}>
              {m.photoUri ? (
                <Image source={{ uri: m.photoUri }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text style={styles.avatarInitial}>
                    {(m.name || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.avatarStem} />
          </View>
        </Marker>
      ))}
    </MLMap>
  );
});

// Live "you are here" dot: a breathing halo + solid core with a white ring
// and a soft shadow. This is the single strongest "premium map" cue.
function UserDot() {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2200,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.4, 2.6] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });
  return (
    <View style={styles.userWrap}>
      <Animated.View style={[styles.userPulse, { transform: [{ scale }], opacity }]} />
      <View style={styles.userCore} />
    </View>
  );
}

const AVATAR = 40;
const styles = StyleSheet.create({
  fill: { flex: 1 },
  userWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  userPulse: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3B82F6',
  },
  userCore: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#3B82F6',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#1E3A8A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  avatarPin: { alignItems: 'center' },
  avatarRing: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: '#FFFFFF',
    padding: 2.5,
    shadowColor: '#2D2924',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 5,
  },
  avatarImg: { width: '100%', height: '100%', borderRadius: AVATAR / 2 },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR / 2,
    backgroundColor: '#7BC47F',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#FFFFFF', fontFamily: 'Poppins_700Bold', fontSize: 16 },
  avatarStem: {
    width: 4,
    height: 8,
    backgroundColor: '#FFFFFF',
    marginTop: -2,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
  },
});
