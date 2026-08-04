import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { GeoPoint } from '@/types';
import { LEAFLET_JS, LEAFLET_CSS } from './leaflet-src';

// OpenStreetMap-based map. Uses Leaflet (MIT) inside a WebView with OSM tiles.
// Completely free — no Google Maps / Mapbox API key required.
//
// Rendering model: we mount the WebView ONCE with an empty Leaflet map and
// expose `window.__orbiiMap.update(...)` inside. React-side prop changes are
// pushed in via `injectJavaScript`, which animates markers (setLatLng) and
// swaps polylines without a full reload. That gives Swiggy/Doordash-style
// smooth live tracking and eliminates the flicker you get when the HTML
// source string changes on every prop update.

export type OSMMarker = {
  id: string;
  coordinate: GeoPoint;
  html?: string;
  pulse?: boolean;
  kind?: 'user' | 'helper' | 'destination';
};

export type OSMPolyline = {
  id: string;
  coordinates: GeoPoint[];
  color?: string;
  width?: number;
  dashed?: boolean;
  // When true, render a filled polygon (a closed area) instead of a line.
  fill?: boolean;
  fillColor?: string;
  fillOpacity?: number;
};

// A circle in METRES (e.g. a GPS accuracy ring around a member).
export type OSMCircle = {
  id: string;
  center: GeoPoint;
  radiusM: number;
  color?: string;
  fillColor?: string;
  fillOpacity?: number;
};

type Props = {
  center: GeoPoint;
  zoom?: number;
  style?: StyleProp<ViewStyle>;
  markers?: OSMMarker[];
  polylines?: OSMPolyline[];
  circles?: OSMCircle[];
  fitAll?: boolean;
  interactive?: boolean;
  // Show Leaflet's default +/- zoom buttons. Defaults to `interactive`'s
  // value; pass false to hide them while keeping pinch-zoom available.
  showZoomControls?: boolean;
  onMarkerPress?: (id: string) => void;
  // Fires when the user taps the map, with the tapped coordinate. Used to drop
  // pins (e.g. the geofence corner editor).
  onMapPress?: (coord: GeoPoint) => void;
};

// CARTO "Voyager": a clean, modern, high-DPI basemap (looks like a premium app,
// not the dated raw-OSM tiles). {r} + detectRetina serve @2x tiles on good screens.
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap © CARTO';

function defaultIconHtml(kind: OSMMarker['kind'] = 'helper'): string {
  switch (kind) {
    case 'user':
      return `<div style="width:18px;height:18px;border-radius:9px;background:#FF0000;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.25);"></div>`;
    case 'destination':
      return `<div style="width:22px;height:22px;border-radius:11px;background:#FF0000;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`;
    case 'helper':
    default:
      return `<div style="width:34px;height:34px;border-radius:17px;background:#1976D2;border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,Roboto,sans-serif;font-weight:700;font-size:13px;box-shadow:0 2px 8px rgba(0,0,0,0.25);">H</div>`;
  }
}

function serializeMarkers(markers: OSMMarker[]) {
  return markers.map((m) => ({
    id: m.id,
    lat: m.coordinate.latitude,
    lng: m.coordinate.longitude,
    html: m.html ?? defaultIconHtml(m.kind),
    pulse: !!m.pulse,
  }));
}

function serializePolylines(polylines: OSMPolyline[]) {
  return polylines.map((p) => ({
    id: p.id,
    coords: p.coordinates.map((c) => [c.latitude, c.longitude]),
    color: p.color ?? '#FF0000',
    width: p.width ?? 5,
    dashed: !!p.dashed,
    fill: !!p.fill,
    fillColor: p.fillColor ?? p.color ?? '#FF0000',
    fillOpacity: p.fillOpacity == null ? 0.16 : p.fillOpacity,
  }));
}

function serializeCircles(circles: OSMCircle[]) {
  return circles.map((c) => ({
    id: c.id,
    lat: c.center.latitude,
    lng: c.center.longitude,
    radius: c.radiusM,
    color: c.color ?? '#8672CE',
    fillColor: c.fillColor ?? c.color ?? '#8672CE',
    fillOpacity: c.fillOpacity == null ? 0.12 : c.fillOpacity,
  }));
}

function buildHtml(
  center: GeoPoint,
  zoom: number,
  interactive: boolean,
  showZoomControls: boolean,
): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no" />
<style>${LEAFLET_CSS}</style>
<style>
  html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#f4f4f4;}
  .leaflet-container{background:#f4f4f4;font-family:-apple-system,Roboto,sans-serif;}
  .orbii-pulse{
    position:absolute;top:50%;left:50%;width:18px;height:18px;
    margin-left:-9px;margin-top:-9px;border-radius:50%;
    background:#FF0000;opacity:0.5;
    animation:orbii-pulse 1.8s ease-out infinite;
  }
  @keyframes orbii-pulse{
    0%{transform:scale(0.4);opacity:0.6;}
    100%{transform:scale(3);opacity:0;}
  }
  .leaflet-marker-icon{transition:transform 0.6s linear;}
  .leaflet-bar a, .leaflet-bar a:hover { background:#fff; color:#111; }
  .leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,0.6);}
</style>
</head>
<body>
<div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>
(function(){
  function post(payload){
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    }
  }

  var map = L.map('map', {
    zoomControl: ${showZoomControls ? 'true' : 'false'},
    dragging: ${interactive ? 'true' : 'false'},
    touchZoom: ${interactive ? 'true' : 'false'},
    doubleClickZoom: ${interactive ? 'true' : 'false'},
    scrollWheelZoom: ${interactive ? 'true' : 'false'},
    boxZoom: ${interactive ? 'true' : 'false'},
    keyboard: false,
    attributionControl: false,
  }).setView([${center.latitude}, ${center.longitude}], ${zoom});

  L.tileLayer('${TILE_URL}', {
    maxZoom: 20,
    subdomains: 'abcd',
    detectRetina: true,
    updateWhenIdle: false,
    keepBuffer: 4,
    attribution: '${TILE_ATTRIBUTION}',
    crossOrigin: true,
  }).addTo(map);

  map.on('click', function(e){
    post({ type: 'click', lat: e.latlng.lat, lng: e.latlng.lng });
  });

  var markerLayers = {};
  var polylineLayers = {};
  var circleLayers = {};

  function upsertCircle(c){
    var existing = circleLayers[c.id];
    if (existing) {
      existing.setLatLng([c.lat, c.lng]);
      existing.setRadius(c.radius);
      return;
    }
    var circle = L.circle([c.lat, c.lng], {
      radius: c.radius,
      color: c.color,
      weight: 1,
      opacity: 0.6,
      fillColor: c.fillColor,
      fillOpacity: c.fillOpacity,
    }).addTo(map);
    circleLayers[c.id] = circle;
  }

  function buildIcon(m){
    var html = m.pulse
      ? '<div style="position:relative;display:inline-block;">'
        + '<div class="orbii-pulse"></div>' + m.html + '</div>'
      : m.html;
    return L.divIcon({
      html: html,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }

  function upsertMarker(m){
    var existing = markerLayers[m.id];
    if (existing) {
      // smooth move: setLatLng + CSS transition on .leaflet-marker-icon
      var cur = existing.getLatLng();
      if (cur.lat !== m.lat || cur.lng !== m.lng) {
        existing.setLatLng([m.lat, m.lng]);
      }
      if (existing.__html !== m.html || existing.__pulse !== m.pulse) {
        existing.setIcon(buildIcon(m));
        existing.__html = m.html;
        existing.__pulse = m.pulse;
      }
    } else {
      var marker = L.marker([m.lat, m.lng], { icon: buildIcon(m) }).addTo(map);
      marker.__html = m.html;
      marker.__pulse = m.pulse;
      marker.on('click', function(){ post({ type: 'marker', id: m.id }); });
      markerLayers[m.id] = marker;
    }
  }

  function upsertPolyline(p){
    if (!p.coords || p.coords.length < 2) return;
    var existing = polylineLayers[p.id];
    if (existing) {
      existing.halo.setLatLngs(p.coords);
      existing.line.setLatLngs(p.coords);
      return;
    }
    // Filled area (geofence square): one soft-filled polygon, no halo.
    if (p.fill) {
      var poly = L.polygon(p.coords, {
        color: p.color,
        weight: p.width,
        opacity: 0.95,
        fillColor: p.fillColor,
        fillOpacity: p.fillOpacity,
        lineJoin: 'round',
      }).addTo(map);
      polylineLayers[p.id] = { halo: poly, line: poly };
      return;
    }
    var halo = L.polyline(p.coords, {
      color: '#fff',
      weight: p.width + 3,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    var line = L.polyline(p.coords, {
      color: p.color,
      weight: p.width,
      opacity: 1,
      dashArray: p.dashed ? '8,8' : null,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    polylineLayers[p.id] = { halo: halo, line: line };
  }

  function removeMissing(layers, nextIds, remover){
    Object.keys(layers).forEach(function(id){
      if (nextIds.indexOf(id) === -1) {
        remover(layers[id]);
        delete layers[id];
      }
    });
  }

  window.__orbiiMap = {
    update: function(markers, polylines, circles, fitAll){
      try {
        circles = circles || [];
        var markerIds = markers.map(function(m){ return m.id; });
        removeMissing(markerLayers, markerIds, function(m){ map.removeLayer(m); });
        markers.forEach(upsertMarker);

        var polyIds = polylines.map(function(p){ return p.id; });
        removeMissing(polylineLayers, polyIds, function(p){
          map.removeLayer(p.halo);
          map.removeLayer(p.line);
        });
        polylines.forEach(upsertPolyline);

        var circleIds = circles.map(function(c){ return c.id; });
        removeMissing(circleLayers, circleIds, function(c){ map.removeLayer(c); });
        circles.forEach(upsertCircle);

        if (fitAll) {
          var bounds = [];
          markers.forEach(function(m){ bounds.push([m.lat, m.lng]); });
          polylines.forEach(function(p){
            p.coords.forEach(function(c){ bounds.push(c); });
          });
          if (bounds.length >= 2) {
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17, animate: true });
          } else if (bounds.length === 1) {
            map.panTo(bounds[0], { animate: true });
          }
        }
      } catch (e) {
        post({ type: 'error', message: String(e) });
      }
    },
    setView: function(lat, lng, z){
      map.setView([lat, lng], z == null ? map.getZoom() : z, { animate: true });
    },
  };

  post({ type: 'ready' });
})();
true;
</script>
</body>
</html>`;
}

export function OSMMapView({
  center,
  zoom = 15,
  style,
  markers = [],
  polylines = [],
  circles = [],
  fitAll = false,
  interactive = true,
  showZoomControls,
  onMarkerPress,
  onMapPress,
}: Props) {
  const zoomControls = showZoomControls ?? interactive;
  const webviewRef = useRef<WebView>(null);
  const isReadyRef = useRef(false);
  const pendingUpdateRef = useRef<string | null>(null);

  // HTML is built ONCE from the initial center/zoom/interactive. After that,
  // all updates flow through injectJavaScript. This is what keeps the map
  // from flickering when markers move.
  const initialHtml = useMemo(
    () => buildHtml(center, zoom, interactive, zoomControls),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pushUpdate = useCallback(
    (m: OSMMarker[], p: OSMPolyline[], c: OSMCircle[], fit: boolean) => {
      const payload = `window.__orbiiMap && window.__orbiiMap.update(${JSON.stringify(
        serializeMarkers(m),
      )}, ${JSON.stringify(serializePolylines(p))}, ${JSON.stringify(
        serializeCircles(c),
      )}, ${fit ? 'true' : 'false'}); true;`;
      if (isReadyRef.current && webviewRef.current) {
        webviewRef.current.injectJavaScript(payload);
      } else {
        pendingUpdateRef.current = payload;
      }
    },
    [],
  );

  // Serialize deps so effect only fires on real change.
  const markersKey = useMemo(() => JSON.stringify(serializeMarkers(markers)), [markers]);
  const polylinesKey = useMemo(() => JSON.stringify(serializePolylines(polylines)), [polylines]);
  const circlesKey = useMemo(() => JSON.stringify(serializeCircles(circles)), [circles]);

  useEffect(() => {
    pushUpdate(markers, polylines, circles, fitAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markersKey, polylinesKey, circlesKey, fitAll, pushUpdate]);

  // Recenter when the `center` prop changes (e.g. a place-search result), without
  // rebuilding the whole map.
  const centerKey = `${center.latitude},${center.longitude}`;
  useEffect(() => {
    if (isReadyRef.current && webviewRef.current) {
      webviewRef.current.injectJavaScript(
        `window.__orbiiMap && window.__orbiiMap.setView(${center.latitude}, ${center.longitude}, 16); true;`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerKey]);

  const onMessage = (e: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === 'ready') {
        isReadyRef.current = true;
        // flush any update that queued before the map was ready
        const pending = pendingUpdateRef.current;
        if (pending && webviewRef.current) {
          webviewRef.current.injectJavaScript(pending);
          pendingUpdateRef.current = null;
        }
        // also push the current props (first render)
        pushUpdate(markers, polylines, circles, fitAll);
      } else if (msg.type === 'marker' && onMarkerPress) {
        onMarkerPress(msg.id);
      } else if (msg.type === 'click' && onMapPress) {
        onMapPress({ latitude: msg.lat, longitude: msg.lng });
      }
    } catch {
      // ignore
    }
  };

  return (
    <View style={[styles.wrap, style]}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: initialHtml }}
        onMessage={onMessage}
        style={styles.web}
        javaScriptEnabled
        domStorageEnabled
        androidLayerType="hardware"
        scrollEnabled={false}
        bounces={false}
        automaticallyAdjustContentInsets={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: '#f4f4f4',
    overflow: 'hidden',
  },
  web: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
