import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { addBreadcrumb, reportError } from './error-reporting';
import { presentGeofenceLeavePrompt, dismissGeofenceLeavePrompt } from './notifications';

// Safe zones (geofences).
//
// A circle member draws a zone around someone they love. If that person leaves
// it, the people who set the zone are told, and the event is stored.
//
// Uses the OS geofencing API rather than a polling loop: Android does the
// monitoring in the system process, so this costs almost no battery and keeps
// working when ORBII is closed. A JS timer could never do that.

export const GEOFENCE_TASK = 'ORBII_GEOFENCE';

export type Corner = { lat: number; lng: number };

export type Geofence = {
  id: string;
  ownerId: string;
  memberId: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
  active: boolean;
  // The 4 corners the parent drew on the map (null for old radius-only zones).
  corners: Corner[] | null;
};

type Row = {
  id: string;
  owner_id: string;
  member_id: string;
  label: string;
  lat: number;
  lng: number;
  radius_m: number;
  active: boolean;
  corners: Corner[] | null;
};

function fromRow(r: Row): Geofence {
  return {
    id: r.id,
    ownerId: r.owner_id,
    memberId: r.member_id,
    label: r.label,
    lat: r.lat,
    lng: r.lng,
    radiusM: r.radius_m,
    active: r.active,
    corners: Array.isArray(r.corners) ? r.corners : null,
  };
}

// Metres between two lat/lng points (haversine).
function distanceM(a: Corner, b: Corner): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Turn the drawn corners into the circle the OS will actually monitor: the
// centroid, and a radius that covers the farthest corner (clamped 100..5000 m).
export function circleFromCorners(corners: Corner[]): { lat: number; lng: number; radiusM: number } {
  const lat = corners.reduce((s, c) => s + c.lat, 0) / corners.length;
  const lng = corners.reduce((s, c) => s + c.lng, 0) / corners.length;
  const center = { lat, lng };
  const far = Math.max(...corners.map((c) => distanceM(center, c)));
  const radiusM = Math.max(100, Math.min(5000, Math.round(far + 25)));
  return { lat, lng, radiusM };
}

/** Zones set ON me — the ones this device must actually monitor. */
export async function loadMyZones(uid: string): Promise<Geofence[]> {
  const { data, error } = await supabase
    .from('geofences')
    .select('*')
    .eq('member_id', uid)
    .eq('active', true);
  if (error) return [];
  return (data ?? []).map((r) => fromRow(r as Row));
}

/** Zones I set on OTHER people. */
export async function loadZonesISet(uid: string): Promise<Geofence[]> {
  const { data, error } = await supabase
    .from('geofences')
    .select('*')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (error) return [];
  return (data ?? []).map((r) => fromRow(r as Row));
}

export async function createZone(input: {
  ownerId: string;
  memberId: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('geofences').insert({
    owner_id: input.ownerId,
    member_id: input.memberId,
    label: input.label,
    lat: input.lat,
    lng: input.lng,
    radius_m: input.radiusM,
  });
  if (error) {
    // The RLS policy refuses a zone on someone outside your circle. Say so
    // plainly rather than blaming the connection.
    return {
      ok: false,
      error: /row-level security|policy/i.test(error.message)
        ? 'You can only set a safe zone for someone in your circle.'
        : error.message,
    };
  }
  return { ok: true };
}

// Create a zone from the 4 corners the parent drew on the map. Stores the
// corners AND the covering circle the OS actually monitors.
export async function createPolygonZone(input: {
  ownerId: string;
  memberId: string;
  label: string;
  corners: Corner[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.corners.length < 3) {
    return { ok: false, error: 'Place at least 3 corners to draw an area.' };
  }
  const circle = circleFromCorners(input.corners);
  const { error } = await supabase.from('geofences').insert({
    owner_id: input.ownerId,
    member_id: input.memberId,
    label: input.label,
    lat: circle.lat,
    lng: circle.lng,
    radius_m: circle.radiusM,
    corners: input.corners,
  });
  if (error) {
    return {
      ok: false,
      error: /row-level security|policy/i.test(error.message)
        ? 'You can only set a zone for someone in your circle.'
        : error.message,
    };
  }
  return { ok: true };
}

export async function deleteZone(id: string): Promise<boolean> {
  const { error } = await supabase.from('geofences').delete().eq('id', id);
  return !error;
}

// The OS hands us enter/exit events here, even with the app closed.
TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    addBreadcrumb({
      category: 'geofence',
      severity: 'warn',
      message: `geofence task error: ${error.message}`,
    });
    return;
  }
  try {
    const { eventType, region } = data as {
      eventType: Location.GeofencingEventType;
      region: Location.LocationRegion;
    };
    const zoneId = region.identifier;
    if (!zoneId) return;

    const uid = (await supabase.auth.getSession()).data.session?.user?.id;
    if (!uid) return;

    const kind =
      eventType === Location.GeofencingEventType.Exit ? 'exit' : 'enter';

    // Store the event (this is the family's history), and capture its id.
    const { data: inserted } = await supabase
      .from('geofence_events')
      .insert({
        geofence_id: zoneId,
        member_id: uid,
        kind,
        lat: region.latitude,
        lng: region.longitude,
      })
      .select('id')
      .single();

    // On EXIT: alert the WHOLE circle immediately (notify-geofence figures out
    // who left, where, and when, and pushes everyone in their circle). The fenced
    // person also gets a heads-up that their circle was told. ENTER is just
    // recorded for history.
    if (kind === 'exit' && inserted?.id) {
      // Fire-and-forget: alert everyone in the circle right away.
      supabase.functions
        .invoke('notify-geofence', { body: { geofenceId: zoneId, kind: 'exit', eventId: inserted.id } })
        .catch(() => {
          // Best-effort — a failed push must never throw here or Android may
          // stop delivering geofence events to us.
        });
      const { data: g } = await supabase
        .from('geofences')
        .select('label')
        .eq('id', zoneId)
        .maybeSingle();
      const label = (g as { label?: string } | null)?.label ?? 'an area';
      await presentGeofenceLeavePrompt(inserted.id, label, zoneId);
    }
  } catch (err) {
    reportError(err, { category: 'geofence', message: 'geofence event failed' });
  }
});

/**
 * Start monitoring every zone set on me. Safe to call repeatedly: it replaces
 * the previous set, so adding or removing a zone just re-syncs.
 */
export async function syncZoneMonitoring(uid: string): Promise<void> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted) return;
    // Geofencing needs background location on Android. Without it the OS will
    // not deliver events once the app is closed, which is the only time it
    // matters. A denial isn't fatal — we just can't monitor.
    const bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted) return;

    const zones = await loadMyZones(uid);
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);

    if (zones.length === 0) {
      if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
      return;
    }

    // Android caps geofences per app (100). We're nowhere near, but slice
    // defensively so a runaway list can never break monitoring entirely.
    const regions: Location.LocationRegion[] = zones.slice(0, 90).map((z) => ({
      identifier: z.id,
      latitude: z.lat,
      longitude: z.lng,
      radius: z.radiusM,
      notifyOnEnter: true,
      notifyOnExit: true,
    }));

    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
    await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
    addBreadcrumb({
      category: 'geofence',
      severity: 'info',
      message: `monitoring ${regions.length} safe zone(s)`,
    });
  } catch (err) {
    reportError(err, { category: 'geofence', message: 'could not sync safe zones' });
  }
}

/** Stop monitoring entirely (sign-out). */
export async function stopZoneMonitoring(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  } catch {
    // already stopped
  }
}

// The fenced person confirms an exit was intentional. Clears the prompt; the
// crossing stays in history. Watchers are NOT alerted.
export async function authorizeGeofenceEvent(eventId: string): Promise<boolean> {
  try {
    await dismissGeofenceLeavePrompt(eventId);
    const { data, error } = await supabase.rpc('authorize_geofence_event', { p_event: eventId });
    return !error && data === true;
  } catch {
    return false;
  }
}

// The fenced person says the exit was NOT intentional (or is escalating). Marks
// it and alerts whoever set the zone via notify-geofence.
export async function escalateGeofenceEvent(eventId: string, geofenceId?: string): Promise<boolean> {
  try {
    await dismissGeofenceLeavePrompt(eventId);
    await supabase.rpc('deny_geofence_event', { p_event: eventId });
    await supabase.functions.invoke('notify-geofence', {
      body: { geofenceId, kind: 'exit', eventId, unauthorized: true },
    });
    return true;
  } catch {
    return false;
  }
}

/** My own unanswered "did you leave?" prompts, for when a notification was missed. */
export type PendingLeave = { eventId: string; geofenceId: string; label: string; createdAt: string };

export async function loadMyPendingLeaves(): Promise<PendingLeave[]> {
  const { data, error } = await supabase.rpc('my_pending_geofence_leaves');
  if (error || !data) return [];
  return (data as { event_id: string; geofence_id: string; label: string; created_at: string }[]).map((r) => ({
    eventId: r.event_id,
    geofenceId: r.geofence_id,
    label: r.label,
    createdAt: r.created_at,
  }));
}

/** Stored history of zone crossings, newest first. */
export type ZoneEvent = {
  id: string;
  kind: 'exit' | 'enter';
  createdAt: string;
  label: string;
  // For exits: true = confirmed intentional, false = flagged/escalated, null = pending.
  authorized: boolean | null;
};

export async function loadZoneEvents(uid: string): Promise<ZoneEvent[]> {
  const { data, error } = await supabase
    .from('geofence_events')
    .select('id, kind, created_at, authorized, geofences(label)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      kind: 'exit' | 'enter';
      created_at: string;
      authorized: boolean | null;
      geofences?: { label?: string } | { label?: string }[] | null;
    };
    const g = Array.isArray(row.geofences) ? row.geofences[0] : row.geofences;
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      label: g?.label ?? 'Safe zone',
      authorized: row.authorized ?? null,
    };
  });
}
