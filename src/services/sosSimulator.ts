import type { GeoPoint } from '@/types';
import { haversineMeters, interpolate, offsetPoint } from '@/utils/geo';

// Simulates a real-time SOS response without Firestore. Swap with an
// `onSnapshot` listener on the SOS document + helper documents when
// Firestore is wired.

export type SimulatedHelper = {
  id: string;
  name: string;
  photoUri: string | null;
  rating: number;
  phone: string;
  location: GeoPoint;
  destination: GeoPoint;
  acceptedAt: number;
};

export type SimulatorState = {
  helpers: SimulatedHelper[];
  resolved: boolean;
  resolvedBy: SimulatedHelper | null;
};

export type SimulatorOptions = {
  onState: (state: SimulatorState) => void;
  onArrived?: (helper: SimulatedHelper) => void;
};

type Listener = (state: SimulatorState) => void;

const SEED_HELPERS: Omit<SimulatedHelper, 'location' | 'destination' | 'acceptedAt'>[] = [
  {
    id: 'helper_a',
    name: 'Priya Sharma',
    photoUri: null,
    rating: 4.9,
    phone: '+919876500001',
  },
  {
    id: 'helper_b',
    name: 'Rahul Verma',
    photoUri: null,
    rating: 4.7,
    phone: '+919876500002',
  },
  {
    id: 'helper_c',
    name: 'Anjali Rao',
    photoUri: null,
    rating: 4.8,
    phone: '+919876500003',
  },
];

const ACCEPT_DELAYS_MS = [2_000, 5_500, 9_000];
const TICK_MS = 1_000;
const HELPER_SPEED_MPS = 6; // ~22 km/h

export function startSOSSimulation(
  userLocation: GeoPoint,
  options: SimulatorOptions,
): () => void {
  const listener: Listener = options.onState;
  let state: SimulatorState = {
    helpers: [],
    resolved: false,
    resolvedBy: null,
  };

  const timers: ReturnType<typeof setTimeout>[] = [];
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const arrived = new Set<string>();

  const emit = () => listener({ ...state, helpers: state.helpers.map((h) => ({ ...h })) });

  // Pick starting positions for each helper around the user, varying bearing.
  const spawnPoint = (idx: number): GeoPoint => {
    const bearing = (idx * (2 * Math.PI)) / SEED_HELPERS.length + 0.4;
    const distance = 650 + idx * 220; // 650m, 870m, 1090m
    return offsetPoint(userLocation, distance, bearing);
  };

  SEED_HELPERS.forEach((seed, idx) => {
    const t = setTimeout(() => {
      if (state.resolved) return;
      const start = spawnPoint(idx);
      const helper: SimulatedHelper = {
        ...seed,
        location: start,
        destination: userLocation,
        acceptedAt: Date.now(),
      };
      state = { ...state, helpers: [...state.helpers, helper] };
      emit();
    }, ACCEPT_DELAYS_MS[idx] ?? 10_000);
    timers.push(t);
  });

  tickTimer = setInterval(() => {
    if (state.resolved) return;
    if (state.helpers.length === 0) return;

    let changed = false;
    const nextHelpers = state.helpers.map((h) => {
      const remaining = haversineMeters(h.location, userLocation);
      if (remaining < 5) return h;
      const stepMeters = HELPER_SPEED_MPS * (TICK_MS / 1000);
      const t = Math.min(1, stepMeters / remaining);
      const moved = interpolate(h.location, userLocation, t);
      changed = true;
      return { ...h, location: moved };
    });

    // Check for arrival (closest helper within 50m auto-resolves).
    const closest = nextHelpers.reduce<SimulatedHelper | null>(
      (best, h) => {
        if (best && haversineMeters(best.location, userLocation) <
          haversineMeters(h.location, userLocation)) {
          return best;
        }
        return h;
      },
      null,
    );

    if (closest && haversineMeters(closest.location, userLocation) < 50) {
      if (!arrived.has(closest.id)) {
        arrived.add(closest.id);
        options.onArrived?.(closest);
      }
      state = {
        helpers: nextHelpers,
        resolved: true,
        resolvedBy: closest,
      };
      emit();
      return;
    }

    if (changed) {
      state = { ...state, helpers: nextHelpers };
      emit();
    }
  }, TICK_MS);

  // Initial empty emit so UI shows "finding helpers" state.
  emit();

  return () => {
    timers.forEach(clearTimeout);
    if (tickTimer) clearInterval(tickTimer);
  };
}
