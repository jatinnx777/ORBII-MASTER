import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import { getItem, setItem, removeItem } from './storage';
import { getAgeStatus } from './consent';
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
  /**
   * This row is here because they have an ACTIVE SOS, not because sharing is
   * on (sql/118). Never render it as ordinary sharing: an SOS releases the row
   * for the duration of the emergency and nothing longer, and saying "sharing"
   * would misstate what she agreed to.
   */
  emergency: boolean;
  /**
   * Age of the fix in seconds, computed server-side.
   *
   * Every screen used to work this out from updatedAt, which meant every
   * screen could forget. One did: the history sheet a parent actually reads
   * rendered a forty-minute-old pin exactly like a live one.
   */
  ageSeconds: number;
  /**
   * Sharing is ON and nothing has arrived for twenty minutes. A dead battery,
   * a basement, or a phone that was taken. This is the state a circle should
   * be told about rather than left to infer from a pin that has not moved.
   */
  unreachable: boolean;
};

export type TrailPoint = { lat: number; lng: number; at: string };

/**
 * Battery percentage, or null if the device will not say.
 *
 * The circle_locations table has had a battery column since sql/70 and both
 * call sites below passed a literal null into it, so the column has been
 * empty for every user since the day it was added. expo-battery was already
 * a dependency. Nothing was missing except this function.
 *
 * It matters because a phone at 8% is a pipeline that is about to fail, and a
 * circle that is told beforehand can do something about it. sql/118's presence
 * sweep reads this column, so leaving it null would have shipped a cron job
 * that could never fire.
 *
 * Never throws. A battery read that fails must not stop a location push, which
 * is the part that actually matters.
 */
async function batteryPct(): Promise<number | null> {
  try {
    // Imported here rather than at the top of the file on purpose. A static
    // import pulls expo-modules-core into the module graph, and this module
    // also exports pure functions (sameMemberLocations, detectStops,
    // dwellMinutes) that are unit-tested in a plain node environment where
    // that native bridge does not exist. The static import broke those tests
    // the moment it was added. Deferring it also keeps a native module off the
    // startup path for something only read during a location push.
    const Battery = await import('expo-battery');
    const level = await Battery.getBatteryLevelAsync();
    // -1 is expo-battery's "unsupported" sentinel, and rounding it gives -100,
    // which would read as a catastrophically dead phone and alert the circle.
    if (typeof level !== 'number' || level < 0) return null;
    return Math.round(level * 100);
  } catch {
    return null;
  }
}

/**
 * True when two member-location lists are equivalent for display purposes.
 *
 * Every poll used to hand React a brand-new array, so markers, rings, trails and
 * their JSON payloads were all re-derived even when nobody had moved. With four
 * mostly-stationary people that was almost all wasted work, and it is what made
 * the map feel heavy. Callers keep the previous array when this returns true.
 */
export function sameMemberLocations(a: MemberLocation[], b: MemberLocation[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.userId !== y.userId ||
      x.lat !== y.lat ||
      x.lng !== y.lng ||
      x.updatedAt !== y.updatedAt ||
      x.sharing !== y.sharing ||
      x.battery !== y.battery
    ) {
      return false;
    }
  }
  return true;
}

// Background task: push the latest fix to the server.
TaskManager.defineTask(CIRCLE_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  try {
    // Auto-off: the moment the chosen window is up, stop sharing, even if the
    // app is closed. The task fires ~every minute, so it self-stops promptly.
    const exp = await getItem<number>(SHARE_EXPIRES_KEY);
    if (exp && Date.now() >= exp) {
      await stopCircleSharing({ notify: false });
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
      p_battery: await batteryPct(),
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
    //
    // Only a DECLARED minor is blocked. 'unknown' means we never asked, which is
    // true of everyone who signed up before the date-of-birth field existed, and
    // treating that as under-18 locked adults out of their own feature. Callers
    // ask once via ensureAgeKnown() and we remember the answer.
    if ((await getAgeStatus()) === 'minor') return false;
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
        p_battery: await batteryPct(),
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

/**
 * Stop sharing, keep the last known position, and tell the circle.
 *
 * `notify` defaults to true because turning sharing off is exactly the moment
 * the people who care about you most need to hear something. Nothing prevents
 * anyone switching this off, and nothing should: a safety app you can be locked
 * into is a tracking device. What we guarantee instead is that it is never
 * silent. Everyone in the circle gets the time it went off and the last place
 * that person was seen, which is information they can act on rather than a dot
 * that quietly stopped moving.
 *
 * Pass notify: false only for the automatic window expiry, where the circle was
 * already warned an hour ahead and a second alarm would be noise.
 */
export async function stopCircleSharing(opts: { notify?: boolean } = {}): Promise<void> {
  const notify = opts.notify !== false;
  // Grab the last fix BEFORE clearing, so the alert can say where they were.
  let last: { lat: number; lng: number } | null = null;
  if (notify) {
    try {
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) last = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    } catch {
      // no fix available, the alert still carries the time
    }
  }

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

  if (notify) {
    // Fire-and-forget. A failed push must never make turning sharing off feel
    // broken, and the map still shows "location off, last seen ..." regardless.
    void (async () => {
      try {
        let place: string | undefined;
        if (last) {
          const { reverseGeocode } = await import('./geocode');
          place = await reverseGeocode(last.lat, last.lng);
        }
        await supabase.functions.invoke('notify-sharing-off', {
          body: { lat: last?.lat, lng: last?.lng, place },
        });
      } catch {
        /* best effort */
      }
    })();
  }
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
  if (exp && Date.now() >= exp) await stopCircleSharing({ notify: false });
}

/**
 * When the current sharing window ends, in epoch ms, or null when sharing is
 * always-on (or off). Lets the UI say "until 9:30 PM" instead of leaving people
 * guessing how long they stay visible.
 */
export async function circleSharingExpiry(): Promise<number | null> {
  const exp = await getItem<number>(SHARE_EXPIRES_KEY);
  return exp && exp > Date.now() ? exp : null;
}

export async function isCircleSharing(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(CIRCLE_LOCATION_TASK);
  } catch {
    return (await getItem<boolean>(SHARING_KEY)) ?? false;
  }
}

/**
 * Position push during an active SOS, whatever the sharing setting says.
 *
 * THE CASE THIS EXISTS FOR. She turns sharing on for the walk home, it lapses
 * after two hours, and later that night she says the word. Her circle opens
 * the map during the emergency and, without this, sees a grey pin from
 * wherever she was when the window closed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not turn sharing on. The ordinary
 * set_circle_location sets `sharing = true` and clears `sharing_off_at` on
 * every write, so using it here would leave her permanently sharing after an
 * emergency she never chose that for. The SOS RPC writes position and nothing
 * else, and the server refuses the call outright unless the caller genuinely
 * has an active SOS, so this cannot become a way to write a position while
 * appearing not to share.
 *
 * Silent by design. It runs inside a background location task during an
 * emergency, where the only thing worth doing about a failure is not making it
 * worse.
 */
export async function pushCircleLocationDuringSos(
  point: { latitude: number; longitude: number },
  accuracyM: number | null,
): Promise<void> {
  try {
    await supabase.rpc('set_circle_location_sos', {
      p_lat: point.latitude,
      p_lng: point.longitude,
      p_acc: accuracyM,
      p_battery: await batteryPct(),
    });
  } catch {
    // The helper channel is the primary one and has already been published to.
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
    // All three default to the safe reading if the server is older than
    // sql/118: no emergency, and not unreachable. Age falls back to computing
    // it here rather than reporting zero, because zero would mean "just now".
    emergency: r.emergency === true,
    ageSeconds:
      typeof r.age_seconds === 'number'
        ? (r.age_seconds as number)
        : Math.max(0, Math.round((Date.now() - Date.parse(r.updated_at as string)) / 1000)),
    unreachable: r.unreachable === true,
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

// ---------------------------------------------------------------------------
// A day, as a readable timeline.
//
// detectStops() answers "where did they pause". A person reading a history
// wants the whole day in order: arrived here, stayed this long, travelled this
// far, arrived there. So the timeline interleaves stops with the journeys
// between them, oldest first, the way a day is actually lived.
// ---------------------------------------------------------------------------

export type TimelineStop = {
  kind: 'stop';
  lat: number;
  lng: number;
  from: string;
  to: string;
  minutes: number;
};

export type TimelineMove = {
  kind: 'move';
  from: string;
  to: string;
  minutes: number;
  metres: number;
  /** The points travelled, so the map can highlight just this leg. */
  path: TrailPoint[];
};

export type TimelineEntry = TimelineStop | TimelineMove;

/**
 * Build the day. `trail` arrives newest-first (as loadMemberTrail returns it);
 * the result is oldest-first, because that is reading order for a day.
 *
 * Journeys shorter than 200 m are dropped: GPS drift between two stops in the
 * same building is not a trip anywhere, and showing it as one makes the whole
 * timeline look wrong.
 */
export function buildDayTimeline(trail: TrailPoint[]): TimelineEntry[] {
  if (trail.length < 2) return [];
  const stops = detectStops(trail).slice().reverse(); // oldest first
  if (stops.length === 0) return [];

  const chrono = trail.slice().reverse(); // oldest first
  const out: TimelineEntry[] = [];

  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    out.push({ kind: 'stop', lat: s.lat, lng: s.lng, from: s.from, to: s.to, minutes: s.minutes });

    const next = stops[i + 1];
    if (!next) continue;

    // Everything recorded between leaving this stop and reaching the next one.
    const legStart = Date.parse(s.to);
    const legEnd = Date.parse(next.from);
    const path = chrono.filter((p) => {
      const t = Date.parse(p.at);
      return t >= legStart && t <= legEnd;
    });

    let metres = 0;
    for (let j = 1; j < path.length; j++) {
      metres += metresBetween(path[j - 1].lat, path[j - 1].lng, path[j].lat, path[j].lng);
    }
    // Straight-line floor, so a leg with sparse points is not reported as 0 m.
    metres = Math.max(metres, metresBetween(s.lat, s.lng, next.lat, next.lng));
    if (metres < 200) continue;

    out.push({
      kind: 'move',
      from: s.to,
      to: next.from,
      minutes: Math.max(1, Math.round((legEnd - legStart) / 60000)),
      metres: Math.round(metres),
      path,
    });
  }
  return out;
}

/** '9:05 AM' */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
