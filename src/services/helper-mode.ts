import { getCurrentLocation } from './location';
import { setHelperLocation, goOffline } from './helpers';
import type { GeoPoint } from '@/types';

// Helper Mode runtime. While enabled, we upload the user's location to
// helpers_live every PING_MS so nearby SOS events can find them. On disable
// (or sign-out) we flip their row offline. Everything is best-effort: a
// failed ping never throws into the UI.

const PING_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let lastPoint: GeoPoint | null = null;

async function pingOnce(): Promise<void> {
  try {
    const point = await getCurrentLocation();
    lastPoint = point;
    await setHelperLocation(point, true);
  } catch {
    // ignore — offline, no permission, or transient RPC error
  }
}

/** Begin advertising as an available helper. Safe to call repeatedly. */
export async function startHelperMode(): Promise<void> {
  await pingOnce();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void pingOnce();
  }, PING_MS);
}

/** Stop advertising and mark the helper offline. */
export async function stopHelperMode(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  await goOffline(lastPoint);
  lastPoint = null;
}

export function isHelperModeRunning(): boolean {
  return timer !== null;
}
