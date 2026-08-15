// Free place search (geocoding). No API key required by default.
//
// Ranked by quality:
//   1. LocationIQ (if LOCATIONIQ_KEY is set), best India coverage + autocomplete,
//      free tier 5,000/day at https://locationiq.com. Paste a free key below to
//      dramatically improve results (finds colleges/hospitals raw OSM misses).
//   2. Photon (komoot, OSM), no key, biased to the user's location so nearby
//      Indian places rank first.
//   3. Nominatim (OSM), no key, restricted to India (countrycodes=in).

// Optional: paste a free LocationIQ key here for the best results. Leave '' to
// use the no-key providers below.
const LOCATIONIQ_KEY = '';

export type Place = { name: string; lat: number; lng: number };
export type Near = { lat: number; lng: number };

function label(props: Record<string, unknown>): string {
  const parts = [props.name, props.street, props.district, props.city, props.state]
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) if (out[out.length - 1] !== p) out.push(p);
  return out.join(', ') || 'Unnamed place';
}

async function viaLocationIQ(q: string): Promise<Place[]> {
  const res = await fetch(
    `https://api.locationiq.com/v1/autocomplete?key=${LOCATIONIQ_KEY}&q=${encodeURIComponent(q)}&countrycodes=in&limit=6&dedupe=1`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return (data ?? [])
    .filter((d) => d.lat && d.lon)
    .map((d) => ({ name: d.display_name ?? 'Place', lat: parseFloat(d.lat!), lng: parseFloat(d.lon!) }));
}

async function viaPhoton(q: string, near?: Near): Promise<Place[]> {
  const bias = near ? `&lat=${near.lat}&lon=${near.lng}` : '';
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lang=en${bias}`);
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features?: { geometry?: { coordinates?: [number, number] }; properties?: Record<string, unknown> }[];
  };
  const out: Place[] = [];
  for (const f of data.features ?? []) {
    const c = f.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    out.push({ name: label(f.properties ?? {}), lat: c[1], lng: c[0] });
  }
  return out;
}

async function viaNominatim(q: string): Promise<Place[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=in&q=${encodeURIComponent(q)}`,
    { headers: { Accept: 'application/json' } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { display_name?: string; lat?: string; lon?: string }[];
  return (data ?? [])
    .filter((d) => d.lat && d.lon)
    .map((d) => ({ name: d.display_name ?? 'Place', lat: parseFloat(d.lat!), lng: parseFloat(d.lon!) }));
}

export async function searchPlaces(query: string, near?: Near): Promise<Place[]> {
  const q = query.trim();
  if (q.length < 3) return [];
  try {
    if (LOCATIONIQ_KEY) {
      const r = await viaLocationIQ(q);
      if (r.length) return r;
    }
    const photon = await viaPhoton(q, near);
    if (photon.length) return photon;
    return await viaNominatim(q);
  } catch {
    try {
      return await viaNominatim(q);
    } catch {
      return [];
    }
  }
}
