import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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

// Avatar marker — a circle member shown on the map with their photo (or
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

// OpenFreeMap "liberty" — community-funded vector basemap, MIT-licensed
// data, NO API key, NO rate limits. The "liberty" style is the warm,
// colourful Google-Maps-like theme (green parks, blue water, soft cream
// roads + labels) that matches ORBII's reference design far better than
// the minimal grey "positron". Vector tiles → smooth zoom, crisp labels.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

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
  // Camera tracks user — flips on a built-in MapLibre tracking mode.
  followUser?: boolean;
  interactive?: boolean;
  // Padding when `fitAll` is on. Defaults to a comfortable safe-area value.
  fitPadding?: number;
};

export type MLMapViewHandle = {
  fitTo: (points: GeoPoint[], padding?: number) => void;
  flyTo: (point: GeoPoint, zoom?: number) => void;
};

// Pin palette — aligned to the warm design tokens. User is a calm blue
// dot (as in the reference), helpers are lavender (verified = deeper
// lavender), destination is the soft coral.
const COLOURS = {
  user: '#4A90E2',
  helper: '#8E7CC0',
  'helper-verified': '#6F5DA6',
  destination: '#E07A5F',
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

  const markerFC = useMemo(() => markersToFeatureCollection(markers), [markers]);
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
      mapStyle={STYLE_URL}
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
              'line-color': '#FF0000',
              'line-width': 4,
            }}
            layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          />
        </GeoJSONSource>
      ) : null}

      {markers.length > 0 ? (
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

      {avatarMarkers.map((m) => (
        <Marker key={m.id} coordinate={toCoords(m.coordinate)} anchor="bottom">
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

const AVATAR = 40;
const styles = StyleSheet.create({
  fill: { flex: 1 },
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
    backgroundColor: '#8E7CC0',
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
