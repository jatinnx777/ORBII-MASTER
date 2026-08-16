import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { getItem, setItem, removeItem } from './storage';
import { isDeclaredAdult } from './consent';
import { reportError } from './error-reporting';

// Circle live-location sharing (opt-in). While ON, this phone posts its position
// to circle_locations every ~minute (or 40 m of movement), and everyone the user
// shares a circle with can see it on the Circle map. Turning it OFF stops the
// updates and forgets the last position. Privacy-first: strictly opt-in, only
// visible to your own circles, pausable any time.
//
// ALWAYS time-bounded: sharing is armed for a duration the user picks (max 8h),
// never "forever". The background task self-stops the moment that window is up,
// even with the app closed, and a notification warns her an hour before.

export const CIRCLE_LOCATION_TASK = 'ORBII_CIRCLE_LOCATION';
export const SHARE_MAX_HOURS = 8;
const SHARING_KEY = 'orbii:circle-sharing';
const SHARE_EXPIRES_KEY = 'orbii:circle-sharing-expires';
const SHARE_REMINDER_ID = 'orbii-circle-share-1h';

export type MemberLocation = {
  userId: string;
  name: string | null;
  photoUri: string | null;
  lat: number;
  lng: number;
  updatedAt: string;
  battery: number | null;
  accuracyM: number | null;
  /** false = they turned live location off; this is their last known position. */
  sharing: boolean;
  sharingOffAt: string | null;
};

export type TrailPoint = { lat: number; lng: number; at: string };

// Background task: push the latest fix to the server.
TaskManager.defineTask(CIRCLE_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  try {
    // Auto-off: the moment the chosen window is up, stop sharing, even if the
    // app is closed. The task fires ~every minute, so it self-stops promptly.
    const exp = await getItem<number>(SHARE_EXPIRES_KEY);
    if (exp && Date.now() >= exp) {
      await stopCircleSharing();
      return;
    }
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

/**
 * Begin sharing my live location with my circles.
 *
 * `hours = 0` means always on: sharing continues until it is explicitly turned
 * off, which is what circle members expect from a family-safety app. Any other
 * value arms a bounded window that auto-stops. Either way the phone shows a
 * permanent "ORBII is sharing your location" notification for as long as it is
 * running, so the person being seen always knows. That notification is not
 * optional, it is what separates a safety app from stalkerware, and Google Play
 * requires it.
 */
export async function startCircleSharing(hours = 2): Promise<boolean> {
  try {
    // HARD STOP for minors. DPDP Rules 2025, Rule 10: a Data Fiduciary must not
    // track, monitor or profile a child (under 18), and the penalty for getting
    // this wrong is up to Rs 200 crore. Voice SOS and alerts still protect them
    // fully; only continuous location sharing is withheld. This is checked here,
    // in the one function that can start tracking, so no caller can bypass it.
    if (!(await isDeclaredAdult())) return false;
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return false;
    const always = hours <= 0;
    const h = always ? 0 : Math.min(SHARE_MAX_HOURS, Math.max(0.5, hours));
    const expiresAt = always ? 0 : Date.now() + h * 3_600_000;
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
    // 0 = always on, so store no expiry at all and schedule no wind-down warning.
    if (expiresAt > 0) {
      await setItem(SHARE_EXPIRES_KEY, expiresAt);
      await scheduleShareReminder(expiresAt);
    } else {
      await removeItem(SHARE_EXPIRES_KEY);
      await cancelShareReminder();
    }
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
  await removeItem(SHARE_EXPIRES_KEY);
  await cancelShareReminder();
}

// Warn her an hour before live sharing auto-stops, so it never lapses as a
// surprise (and she can re-arm if she still wants it on).
async function scheduleShareReminder(expiresAtMs: number): Promise<void> {
  try {
    await cancelShareReminder();
    const oneHourBefore = expiresAtMs - 3_600_000;
    if (oneHourBefore <= Date.now()) return;
    await Notifications.scheduleNotificationAsync({
      identifier: SHARE_REMINDER_ID,
      content: {
        title: 'Live location ends soon',
        body: 'Your circle stops seeing you in 1 hour. Open ORBII to keep it on.',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(oneHourBefore) },
    });
  } catch {
    // best-effort, never block sharing on a reminder
  }
}
async function cancelShareReminder(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(SHARE_REMINDER_ID);
  } catch {
    // ignore
  }
}

/** Foreground backup for the auto-off: if the window has passed, stop now. */
export async function ensureCircleShareNotExpired(): Promise<void> {
  const exp = await getItem<number>(SHARE_EXPIRES_KEY);
  if (exp && Date.now() >= exp) await stopCircleSharing();
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
    // Backward-compatible: before sql/70 the column doesn't exist, so a missing
    // value means the row is only present because they're sharing.
    sharing: r.sharing !== false,
    sharingOffAt: (r.sharing_off_at as string) ?? null,
  }));
}

// ── Stop detection ─────────────────────────────────────────────────────────
// A raw breadcrumb trail is noisy and unreadable: hundreds of dots, most of
// them the same place jittering by a few metres. What a person actually wants
// to know is "where did she stop, and for how long". These turn the trail into
// that, entirely on the client, from data we already store.

/** A place the member stayed put, with how long they were there. */
export type Stop = {
  lat: number;
  lng: number;
  /** Oldest fix in the cluster. */
  from: string;
  /** Newest fix in the cluster. */
  to: string;
  minutes: number;
  points: number;
};

/** Metres between two coordinates (haversine). */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Points within this radius of a cluster's anchor count as the same place. */
const STOP_RADIUS_M = 90;
/** Anything shorter than this is passing through, not a stop. */
const MIN_STOP_MINUTES = 5;

/**
 * How long the member has been sitting at their most recent position, in
 * minutes. Walks back through the trail while the fixes stay within
 * STOP_RADIUS_M of the newest one. Returns null when they are on the move.
 * `trail` is newest-first, as loadMemberTrail returns it.
 */
export function dwellMinutes(trail: TrailPoint[]): number | null {
  if (trail.length < 2) return null;
  const head = trail[0];
  let oldest = head;
  for (let i = 1; i < trail.length; i++) {
    const p = trail[i];
    if (metresBetween(head.lat, head.lng, p.lat, p.lng) > STOP_RADIUS_M) break;
    oldest = p;
  }
  const mins = (new Date(head.at).getTime() - new Date(oldest.at).getTime()) / 60000;
  return mins >= MIN_STOP_MINUTES ? Math.round(mins) : null;
}

/**
 * Collapse a trail into the places the member actually stopped. Consecutive
 * fixes within STOP_RADIUS_M of the cluster anchor are one stop; a cluster only
 * counts once it lasted MIN_STOP_MINUTES. Returned newest-first.
 */
export function detectStops(trail: TrailPoint[]): Stop[] {
  if (trail.length < 2) return [];
  const stops: Stop[] = [];
  let anchor = trail[0];
  let group: TrailPoint[] = [anchor];

  const flush = () => {
    if (group.length < 2) return;
    const newest = group[0];
    const oldest = group[group.length - 1];
    const mins = (new Date(newest.at).getTime() - new Date(oldest.at).getTime()) / 60000;
    if (mins < MIN_STOP_MINUTES) return;
    stops.push({
      lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
      lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
      from: oldest.at,
      to: newest.at,
      minutes: Math.round(mins),
      points: group.length,
    });
  };

  for (let i = 1; i < trail.length; i++) {
    const p = trail[i];
    if (metresBetween(anchor.lat, anchor.lng, p.lat, p.lng) <= STOP_RADIUS_M) {
      group.push(p);
    } else {
      flush();
      anchor = p;
      group = [p];
    }
  }
  flush();
  return stops;
}

/** "2h 15m", "45m". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
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
