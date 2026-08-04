import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { getItem, setItem } from './storage';
import { reportError } from './error-reporting';

// Circle live-location sharing (opt-in). While ON, this phone posts its position
// to circle_locations every ~minute (or 40 m of movement), and everyone the user
// shares a circle with can see it on the Circle map. Turning it OFF stops the
// updates and forgets the last position. Privacy-first: strictly opt-in, only
// visible to your own circles, pausable any time.

export const CIRCLE_LOCATION_TASK = 'ORBII_CIRCLE_LOCATION';
const SHARING_KEY = 'orbii:circle-sharing';

export type MemberLocation = {
  userId: string;
  name: string | null;
  photoUri: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
  battery: number | null;
  accuracyM: number | null;
};

export type TrailPoint = { lat: number; lng: number; at: string };

// Background task: push the latest fix to the server.
TaskManager.defineTask(CIRCLE_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  try {
    const { locations } = (data as { locations?: Location.LocationObject[] }) ?? {};
    const loc = locations?.[locations.length - 1];
    if (!loc) return;
    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return;
    await supabase.rpc('set_circle_location', {
      p_lat: loc.coords.latitude,
      p_lng: loc.coords.longitude,
      p_acc: loc.coords.accuracy ?? null,
      p_battery: null,
    });
  } catch (err) {
    reportError(err, { category: 'circle.location', message: 'background push failed' });
  }
});

/** Begin sharing my live location with my circles. Returns success. */
export async function startCircleSharing(): Promise<boolean> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    // Background is best-effort: without it, sharing only updates while the app
    // is open, which is still useful. With it, it keeps working in the pocket.
    await Location.requestBackgroundPermissionsAsync().catch(() => undefined);

    const running = await Location.hasStartedLocationUpdatesAsync(CIRCLE_LOCATION_TASK).catch(() => false);
    if (!running) {
      await Location.startLocationUpdatesAsync(CIRCLE_LOCATION_TASK, {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 60_000,
        distanceInterval: 40,
        showsBackgroundLocationIndicator: false,
        pausesUpdatesAutomatically: false,
        foregroundService: {
          notificationTitle: 'ORBII is sharing your location',
          notificationBody: 'Your circle can see where you are. Tap to manage.',
        },
      });
    }
    // Push one immediate fix so members see you right away.
    try {
      const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await supabase.rpc('set_circle_location', {
        p_lat: now.coords.latitude,
        p_lng: now.coords.longitude,
        p_acc: now.coords.accuracy ?? null,
        p_battery: null,
      });
    } catch {
      // ignore; the background task will catch up
    }
    await setItem(SHARING_KEY, true);
    return true;
  } catch (err) {
    reportError(err, { category: 'circle.location', message: 'could not start sharing' });
    return false;
  }
}

/** Stop sharing and forget my last position. */
export async function stopCircleSharing(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(CIRCLE_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(CIRCLE_LOCATION_TASK);
    }
  } catch {
    // already stopped
  }
  try {
    await supabase.rpc('clear_circle_location');
  } catch {
    // best-effort
  }
  await setItem(SHARING_KEY, false);
}

export async function isCircleSharing(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(CIRCLE_LOCATION_TASK);
  } catch {
    return (await getItem<boolean>(SHARING_KEY)) ?? false;
  }
}

/** Latest positions of everyone in my circles who is currently sharing. */
export async function loadCircleMembersLocations(): Promise<MemberLocation[]> {
  const { data, error } = await supabase.rpc('circle_members_locations');
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    userId: r.user_id as string,
    name: (r.name as string) ?? null,
    photoUri: (r.photo_url as string) ?? null,
    lat: r.lat as number,
    lng: r.lng as number,
    updatedAt: r.updated_at as string,
    battery: (r.battery as number) ?? null,
    accuracyM: (r.accuracy_m as number) ?? null,
  }));
}

/** A member's recent breadcrumb trail (newest first) for the history view. */
export async function loadMemberTrail(userId: string, hours = 12): Promise<TrailPoint[]> {
  const { data, error } = await supabase.rpc('circle_member_trail', { p_uid: userId, p_hours: hours });
  if (error || !data) return [];
  return (data as Record<string, unknown>[]).map((r) => ({
    lat: r.lat as number,
    lng: r.lng as number,
    at: r.at as string,
  }));
}
