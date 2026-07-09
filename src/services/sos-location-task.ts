import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { publishVictimLocation, type VictimPublishHandle } from './live-location';
import { getItem, setItem } from './storage';
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
  } catch (err) {
    reportError(err, {
      category: 'sos.location',
      message: 'background victim location publish failed',
    });
  }
});

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

    await Location.startLocationUpdatesAsync(SOS_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 3000,
      distanceInterval: 5,
      // Never let Android decide the emergency is boring and pause us.
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'ORBII SOS is active',
        notificationBody: 'Sharing your live location with your helpers.',
        notificationColor: '#4BAD3F',
      },
    });
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
