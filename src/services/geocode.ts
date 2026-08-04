// Free place search (geocoding). No API key. Uses Photon (komoot, built on
// OpenStreetMap) for typeahead-friendly search, and falls back to Nominatim.
// Lets a parent search "Delhi University", "Fortis Hospital", etc. and drop the
// map there before drawing a geofence.

export type Place = { name: string; lat: number; lng: number };

function label(props: Record<string, unknown>): string {
  const parts = [props.name, props.street, props.city, props.state]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  // De-dup consecutive identical parts.
  const out: string[] = [];
  for (const p of parts) if (out[out.length - 1] !== p) out.push(p);
  return out.join(', ') || 'Unnamed place';
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    const res = await fetch(
      `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6`,
    );
    if (res.ok) {
      const data = (await res.json()) as {
        features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }[];
      };
      const out: Place[] = [];
      for (const f of data.features ?? []) {
        const c = f.geometry?.coordinates;
        if (!c || c.length < 2) continue;
        out.push({ name: label(f.properties ?? {}), lat: c[1], lng: c[0] });
      }
      if (out.length > 0) return out;
    }
  } catch {
    // fall through to Nominatim
  }
  // Fallback: Nominatim (OSM).
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${encodeURIComponent(q)}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
    return (data ?? [])
      .filter((d) => d.lat && d.lon)
      .map((d) => ({ name: d.display_name ?? 'Place', lat: parseFloat(d.lat!), lng: parseFloat(d.lon!) }));
  } catch {
    return [];
  }
}
