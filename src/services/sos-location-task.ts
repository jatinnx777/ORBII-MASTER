import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { publishVictimLocation, type VictimPublishHandle } from './live-location';
import { getItem, setItem } from './storage';
import { haversineMeters } from '@/utils/geo';
import { addBreadcrumb, reportError } from './error-reporting';
import type { GeoPoint } from '@/types';

// Victim live-location during an active SOS.
//
// THE BUG THIS FIXES: the publisher used to be a React effect on ActiveSOSScreen
// calling watchLocation(). JS timers and foreground location both stop when the
// screen locks or the app backgrounds — and during a real emergency the phone is
// in a pocket. So live tracking, the feature helpers depend on, died in exactly
// the scenario it exists for. The helper's map would freeze on a stale pin.
//
// The fix is an OS-level background location task backed by a foreground service
// (expo-location declares one with foregroundServiceType="location"). Android
// keeps delivering fixes with the screen off, and the persistent notification is
// required by policy anyway — which is honest: she should be able to see that
// ORBII is sharing her location.

export const SOS_LOCATION_TASK = 'ORBII_SOS_VICTIM_LOCATION';

/** The SOS the task should publish for. Read from disk because the task may run
 *  headless after the OS killed our JS context. */
const ACTIVE_SOS_KEY = 'orbii:sos:active-id';

// The realtime channel is expensive to open, so keep one per SOS across ticks.
let handle: VictimPublishHandle | null = null;
let handleSosId: string | null = null;

// Adaptive cadence. A 3s fix rate plus a foreground service visibly drains the
// phone, and an SOS can run for an hour. When she stops moving there is nothing
// new to send, so we back off; the moment she moves again we tighten up. Fast
// mode is what the helper navigates by, so we resume it eagerly (one moving fix
// is enough) and only relax after a sustained still period.
type Cadence = 'fast' | 'slow';
const FAST = { timeInterval: 3000, distanceInterval: 5 };
const SLOW = { timeInterval: 15000, distanceInterval: 25 };
const STILL_M = 12; // moved less than this = standing still
const STILL_BEFORE_SLOW_MS = 90_000;

let cadence: Cadence = 'fast';
let lastPoint: GeoPoint | null = null;
let stillSince = 0;
let switching = false;

function publisherFor(sosId: string): VictimPublishHandle {
  if (handleSosId !== sosId) {
    handle?.unsubscribe();
    handle = publishVictimLocation(sosId);
    handleSosId = sosId;
  }
  return handle!;
}

// Defined at module scope: TaskManager requires the task to be registered
// before the OS can hand us a headless invocation. App.tsx imports this module.
TaskManager.defineTask(SOS_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    addBreadcrumb({
      category: 'sos.location',
      severity: 'warn',
      message: `background location task error: ${error.message}`,
    });
    return;
  }
  try {
    const sosId = await getItem<string>(ACTIVE_SOS_KEY);
    if (!sosId) return; // SOS resolved; nothing to publish.
    const locations = (data as { locations?: Location.LocationObject[] })?.locations ?? [];
    const last = locations[locations.length - 1];
    if (!last) return;
    const point: GeoPoint = {
      latitude: last.coords.latitude,
      longitude: last.coords.longitude,
    };
    publisherFor(sosId).publish(point);
    await adaptCadence(point);
  } catch (err) {
    reportError(err, {
      category: 'sos.location',
      message: 'background victim location publish failed',
    });
  }
});

/** Start (or restart) the OS location stream at the given cadence. */
async function startUpdates(mode: Cadence): Promise<void> {
  const rate = mode === 'fast' ? FAST : SLOW;
  await Location.startLocationUpdatesAsync(SOS_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: rate.timeInterval,
    distanceInterval: rate.distanceInterval,
    // Never let Android decide the emergency is boring and pause us.
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'ORBII SOS is active',
      notificationBody: 'Sharing your live location with your helpers.',
      notificationColor: '#4BAD3F',
    },
  });
  cadence = mode;
}

/**
 * Decide whether to speed up or slow down. Restarting the stream is the only
 * way to change the OS cadence, so it's guarded: never re-enter, and only slow
 * down after she's been still for a sustained window.
 */
async function adaptCadence(point: GeoPoint): Promise<void> {
  const moved = lastPoint ? haversineMeters(lastPoint, point) : Infinity;
  lastPoint = point;
  const now = Date.now();

  if (moved > STILL_M) {
    stillSince = 0;
    if (cadence === 'slow' && !switching) {
      switching = true;
      try {
        await startUpdates('fast'); // she's moving again — helpers need this
      } catch {
        // keep whatever cadence we had
      } finally {
        switching = false;
      }
    }
    return;
  }

  if (stillSince === 0) stillSince = now;
  if (
    cadence === 'fast' &&
    !switching &&
    now - stillSince >= STILL_BEFORE_SLOW_MS
  ) {
    switching = true;
    try {
      await startUpdates('slow');
    } catch {
      // keep fast; wasting battery beats losing her
    } finally {
      switching = false;
    }
  }
}

/**
 * Start publishing the victim's position for `sosId`, and keep publishing with
 * the screen off. Returns false when the OS wouldn't let us start, so the
 * caller can fall back to foreground-only tracking rather than going silent.
 */
export async function startVictimLocationUpdates(sosId: string): Promise<boolean> {
  await setItem(ACTIVE_SOS_KEY, sosId);
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return false;

    // Best-effort. On Android a foreground service with type=location can keep
    // running without this, so a denial must not stop us trying.
    await Location.requestBackgroundPermissionsAsync().catch(() => undefined);

    if (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK)) return true;

    lastPoint = null;
    stillSince = 0;
    await startUpdates('fast');
    addBreadcrumb({
      category: 'sos.location',
      severity: 'info',
      message: `background victim location started for ${sosId}`,
    });
    return true;
  } catch (err) {
    reportError(err, {
      category: 'sos.location',
      message: 'could not start background victim location',
      tags: { sosId },
    });
    return false;
  }
}

/** Stop publishing. Safe to call when nothing was ever started. */
export async function stopVictimLocationUpdates(): Promise<void> {
  await setItem<string | null>(ACTIVE_SOS_KEY, null);
  try {
    if (await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(SOS_LOCATION_TASK);
    }
  } catch {
    // already stopped
  }
  handle?.unsubscribe();
  handle = null;
  handleSosId = null;
  cadence = 'fast';
  lastPoint = null;
  stillSince = 0;
  switching = false;
}

/**
 * If the app was killed mid-SOS the task may still be registered with no screen
 * to stop it. Called on launch to clean up a stale session.
 */
export async function reconcileVictimLocationTask(): Promise<void> {
  try {
    const sosId = await getItem<string>(ACTIVE_SOS_KEY);
    const running = await Location.hasStartedLocationUpdatesAsync(SOS_LOCATION_TASK);
    if (running && !sosId) await stopVictimLocationUpdates();
  } catch {
    // best-effort
  }
}
