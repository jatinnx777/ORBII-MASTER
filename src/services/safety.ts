import { supabase } from './supabase';
import type { GeoPoint } from '@/types';

// Service layer for the Safety tab. Some endpoints are real (system
// status pings Supabase), others are deterministic mocks until the real
// integrations land. Mocks are clearly labeled and seeded by uid so the
// UI shows stable values across opens.

// ---------------------------------------------------------------------------
// Data breach check
// ---------------------------------------------------------------------------

export type BreachResult = {
  email: string;
  // null = not yet checked, [] = clean, [...] = list of breach names.
  breaches: string[] | null;
  checkedAt: number | null;
};

// Mock breach lookup. Pretends to call HaveIBeenPwned-style API. Returns
// a deterministic result keyed off the email so the user sees the same
// answer on subsequent opens (avoids "is it broken?" doubt).
export async function checkBreaches(email: string): Promise<BreachResult> {
  await new Promise((r) => setTimeout(r, 600));
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { email: '', breaches: null, checkedAt: null };
  }
  const hash = trimmed
    .split('')
    .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) | 0, 0);
  // ~30% of users land on a 1-2 breach result, rest are clean.
  const breaches: string[] = [];
  if (Math.abs(hash) % 10 < 3) {
    const pool = ['LinkedIn 2021', 'Adobe 2013', 'Twitter 2022', 'Canva 2019'];
    breaches.push(pool[Math.abs(hash) % pool.length]);
    if (Math.abs(hash) % 5 === 0) {
      breaches.push(pool[(Math.abs(hash) + 1) % pool.length]);
    }
  }
  return { email: trimmed, breaches, checkedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Crime reports (mock aggregator)
// ---------------------------------------------------------------------------

export type CrimeIncident = {
  id: string;
  category: 'theft' | 'harassment' | 'assault' | 'other';
  daysAgo: number;
  distanceMeters: number;
};

export async function fetchCrimeReports(
  point: GeoPoint | null,
): Promise<{ count30d: number; recent: CrimeIncident[] }> {
  await new Promise((r) => setTimeout(r, 500));
  if (!point) return { count30d: 0, recent: [] };
  // Deterministic mock keyed on rounded coords so the same neighbourhood
  // shows the same numbers each visit.
  const seed = Math.abs(
    Math.round(point.latitude * 1000) * 31 +
      Math.round(point.longitude * 1000),
  );
  const count30d = 4 + (seed % 14);
  const cats: CrimeIncident['category'][] = [
    'theft',
    'harassment',
    'assault',
    'other',
  ];
  const recent: CrimeIncident[] = Array.from({ length: 5 }).map((_, i) => ({
    id: `c${i}`,
    category: cats[(seed + i) % cats.length],
    daysAgo: ((seed + i * 3) % 28) + 1,
    distanceMeters: 200 + ((seed + i * 50) % 1800),
  }));
  return { count30d, recent };
}

// ---------------------------------------------------------------------------
// Travel safety heatmap (mock zones)
// ---------------------------------------------------------------------------

export type HeatZone = {
  id: string;
  center: GeoPoint;
  // 0 (safest) to 1 (most concerning).
  risk: number;
};

export async function fetchHeatZones(point: GeoPoint): Promise<HeatZone[]> {
  await new Promise((r) => setTimeout(r, 400));
  // Sprinkle 10 zones in a 1-km square around the user. Risk is a
  // deterministic function of distance + index so pinches/pans see the
  // same coloured circles each session.
  const zones: HeatZone[] = [];
  for (let i = 0; i < 10; i++) {
    const dx = ((i * 311) % 1000 - 500) / 100000; // ~ +/- 0.005 deg
    const dy = ((i * 613) % 1000 - 500) / 100000;
    zones.push({
      id: `z${i}`,
      center: {
        latitude: point.latitude + dy,
        longitude: point.longitude + dx,
      },
      risk: ((i * 37) % 100) / 100,
    });
  }
  return zones;
}

// ---------------------------------------------------------------------------
// System status
// ---------------------------------------------------------------------------

export type SystemStatus = {
  server: 'online' | 'degraded' | 'offline';
  latencyMs: number;
  lastSyncAt: number;
};

export async function fetchSystemStatus(): Promise<SystemStatus> {
  const started = Date.now();
  try {
    // Cheap reachability ping — counts the rows in users_public (small,
    // RLS-allowed read). If it returns we know the realtime stack is
    // reachable from this device's network.
    const { error } = await supabase
      .from('users_public')
      .select('id', { count: 'exact', head: true })
      .limit(1);
    const latencyMs = Date.now() - started;
    if (error) {
      return { server: 'degraded', latencyMs, lastSyncAt: Date.now() };
    }
    const server: SystemStatus['server'] =
      latencyMs > 800 ? 'degraded' : 'online';
    return { server, latencyMs, lastSyncAt: Date.now() };
  } catch {
    return { server: 'offline', latencyMs: -1, lastSyncAt: Date.now() };
  }
}
