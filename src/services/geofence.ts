import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { supabase } from './supabase';
import { addBreadcrumb, reportError } from './error-reporting';

// Safe zones (geofences).
//
// A circle member draws a zone around someone they love. If that person leaves
// it, the people who set the zone are told, and the event is stored.
//
// Uses the OS geofencing API rather than a polling loop: Android does the
// monitoring in the system process, so this costs almost no battery and keeps
// working when ORBII is closed. A JS timer could never do that.

export const GEOFENCE_TASK = 'ORBII_GEOFENCE';

export type Geofence = {
  id: string;
  ownerId: string;
  memberId: string;
  label: string;
  lat: number;
  lng: number;
  radiusM: number;
  active: boolean;
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
  };
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

    // Store the event. The DB trigger side (notify) is handled server-side by
    // whoever watches this table; storing it is what gives the family a history.
    await supabase.from('geofence_events').insert({
      geofence_id: zoneId,
      member_id: uid,
      kind,
      lat: region.latitude,
      lng: region.longitude,
    });

    // Push the watchers. Best-effort: a failed push must never throw here or
    // Android may stop delivering geofence events to us.
    try {
      await supabase.functions.invoke('notify-geofence', {
        body: { geofenceId: zoneId, kind },
      });
    } catch {
      // ignore
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

/** Stored history of zone crossings, newest first. */
export type ZoneEvent = {
  id: string;
  kind: 'exit' | 'enter';
  createdAt: string;
  label: string;
};

export async function loadZoneEvents(uid: string): Promise<ZoneEvent[]> {
  const { data, error } = await supabase
    .from('geofence_events')
    .select('id, kind, created_at, geofences(label)')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []).map((r) => {
    const row = r as {
      id: string;
      kind: 'exit' | 'enter';
      created_at: string;
      geofences?: { label?: string } | { label?: string }[] | null;
    };
    const g = Array.isArray(row.geofences) ? row.geofences[0] : row.geofences;
    return {
      id: row.id,
      kind: row.kind,
      createdAt: row.created_at,
      label: g?.label ?? 'Safe zone',
    };
  });
}
