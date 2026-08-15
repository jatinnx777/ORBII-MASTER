// Escape a string so it is SAFE to interpolate into HTML that gets rendered in
// a WebView (our Leaflet map, OSMMapView). React Native's <Text> auto-escapes,
// but anything injected as raw HTML into the map WebView does NOT, so any
// user-controlled value (a name, a label) must pass through here first, or a
// value like `<img src=x onerror=...>` would execute in the map.
export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
