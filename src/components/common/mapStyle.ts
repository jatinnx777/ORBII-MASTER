// Custom MapLibre style for ORBII, a calm, premium green-and-cream theme.
//
// Built ENTIRELY on OpenFreeMap's free vector tiles (no API key, no rate
// limits, OpenMapTiles schema). We just repaint the layers in ORBII's palette:
// soft cream land, sage-green parks/greenery, gentle water, clean white roads , 
// the "expensive app" feel without any paid map provider.
//
// If the map ever renders blank, revert by passing `FALLBACK_STYLE_URL` to
// MLMap's `mapStyle` instead of this object (the original OpenFreeMap "liberty"
// theme, known-good).

export const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const OFM_TILES = 'https://tiles.openfreemap.org/planet';
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

// Palette (warm cream + sage greens, matching the ORBII brand).
const C = {
  land: '#F3F6EC', // soft green-cream background
  green: '#C9E4B4', // parks / woods
  grass: '#DCEBCB', // grass / meadow
  water: '#B7DCE3', // calm water
  roadFill: '#FFFFFF',
  roadCasing: '#E9E3D2',
  building: '#E8E2D0',
  label: '#5A6B52',
  labelHalo: '#FFFFFF',
};

export const ORBII_MAP_STYLE = {
  version: 8 as const,
  name: 'ORBII Green',
  glyphs: OFM_GLYPHS,
  sources: {
    openmaptiles: { type: 'vector' as const, url: OFM_TILES },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': C.land } },
    {
      id: 'landcover-wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['==', 'class', 'wood'],
      paint: { 'fill-color': C.green, 'fill-opacity': 0.55 },
    },
    {
      id: 'landcover-grass',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      filter: ['in', 'class', 'grass', 'meadow', 'scrub'],
      paint: { 'fill-color': C.grass, 'fill-opacity': 0.6 },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      paint: { 'fill-color': C.green, 'fill-opacity': 0.5 },
    },
    {
      id: 'landuse-residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: ['==', 'class', 'residential'],
      paint: { 'fill-color': '#ECEFE1', 'fill-opacity': 0.45 },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      paint: { 'fill-color': C.water },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      paint: { 'line-color': C.water, 'line-width': 1.4 },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      paint: { 'fill-color': C.building, 'fill-opacity': 0.55 },
    },
    {
      id: 'road-casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadCasing,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 7],
      },
    },
    {
      id: 'road-minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', 'class', 'minor', 'service', 'track'],
      minzoom: 13,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadFill,
        'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 4],
      },
    },
    {
      id: 'road-major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': C.roadFill,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 16, 5],
      },
    },
    {
      id: 'place-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      filter: ['in', 'class', 'city', 'town', 'village', 'suburb', 'neighbourhood'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 11, 14, 15],
      },
      paint: {
        'text-color': C.label,
        'text-halo-color': C.labelHalo,
        'text-halo-width': 1.3,
      },
    },
    // Street names along roads at close zoom, makes the map read as a real
    // navigation surface, not just a colour field. Subtle, follows the road.
    {
      id: 'road-label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 13,
      filter: ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 18, 13],
        'symbol-placement': 'line',
        'text-letter-spacing': 0.02,
      },
      paint: {
        'text-color': '#8A8071',
        'text-halo-color': '#FFFFFF',
        'text-halo-width': 1.4,
      },
    },
  ],
};
