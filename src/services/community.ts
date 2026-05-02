import { supabase } from './supabase';
import { haversineMeters } from '@/utils/geo';
import type { CommunityAlert, GeoPoint, SOSLocation } from '@/types';

// Community responder: any user (not just verified helpers) can see active
// SOS alerts nearby and respond to help. This is the free/community tier
// alongside the paid/verified helper network.
//
// Transport: Supabase Realtime **broadcast** channel. The victim posts the
// alert once; every subscribed listener receives it instantly. No DB table
// required, no RLS hurdles, no profile-table join — which is why this
// works across two real devices with the same anon key. Alerts are also
// persisted to `sos_events` as a best-effort for history.

const WALKING_MPS = 1.4;
const ALERTS_CHANNEL = 'orbii:alerts';

// Shape of a single broadcast. All fields needed to render the alert card
// travel with the message — no secondary lookup required.
export type AlertBroadcast = {
  id: string;
  victim: {
    id: string;
    name: string;
    photoUri: string | null;
    phone: string | null;
  };
  location: SOSLocation;
  createdAt: number;
  // Priority responders: uids of the victim's friends. Receivers whose uid
  // appears here always see the alert (skipping the 2 km radius gate).
  friendUids?: string[];
};

let broadcastChannel: ReturnType<typeof supabase.channel> | null = null;
let broadcastChannelReady = false;

// Realtime presence — every open app joins a single channel and tracks its
// own row. We use this to count "helpers nearby" without needing a DB table
// or RLS. Presence handles join/leave/heartbeat for us.
const PRESENCE_CHANNEL = 'orbii:presence';
let presenceChannel: ReturnType<typeof supabase.channel> | null = null;
let presenceListeners: Array<(peers: PresencePeer[]) => void> = [];
let lastPresenceState: PresencePeer[] = [];

export type PresencePeer = {
  userId: string;
  name: string;
  photoUri: string | null;
  location: GeoPoint | null;
  // True when the user has completed Aadhaar/ID verification AND turned
  // helper mode on. Drives pin color on the home map (yellow vs green).
  isVerified?: boolean;
  at: number;
};

function ensureBroadcastChannel() {
  if (broadcastChannel) return broadcastChannel;
  broadcastChannel = supabase.channel(ALERTS_CHANNEL, {
    config: { broadcast: { ack: false, self: false } },
  });
  broadcastChannel.subscribe((status) => {
    broadcastChannelReady = status === 'SUBSCRIBED';
    if (status === 'SUBSCRIBED') {
      console.log('[community] broadcast channel ready');
    }
  });
  return broadcastChannel;
}

// Pre-open the broadcast channel at app launch so the first SOS the user
// ever sends doesn't pay the WebSocket handshake cost (which can be 3–8s
// on a cold network). Cheap to call multiple times — idempotent.
export function prewarmBroadcastChannel(): void {
  ensureBroadcastChannel();
}

// Join the presence channel and start announcing our position. Returns a
// handle so the caller can update location and tear down on logout.
export function joinPresence(self: {
  userId: string;
  name: string;
  photoUri: string | null;
  location: GeoPoint | null;
  isVerified?: boolean;
}): { update: (loc: GeoPoint, isVerified?: boolean) => void; leave: () => void } {
  if (presenceChannel) {
    presenceChannel.track({
      userId: self.userId,
      name: self.name,
      photoUri: self.photoUri,
      location: self.location,
      isVerified: !!self.isVerified,
      at: Date.now(),
    });
  } else {
    const ch = supabase.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: self.userId } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, Array<PresencePeer>>;
      const peers: PresencePeer[] = [];
      for (const arr of Object.values(state)) {
        if (arr.length > 0) peers.push(arr[arr.length - 1]);
      }
      lastPresenceState = peers;
      presenceListeners.forEach((cb) => {
        try {
          cb(peers);
        } catch (err) {
          console.warn('[community] presence listener threw', err);
        }
      });
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track({
          userId: self.userId,
          name: self.name,
          photoUri: self.photoUri,
          location: self.location,
          isVerified: !!self.isVerified,
          at: Date.now(),
        });
      }
    });
    presenceChannel = ch;
  }

  return {
    update: (loc: GeoPoint, isVerified?: boolean) => {
      if (!presenceChannel) return;
      presenceChannel.track({
        userId: self.userId,
        name: self.name,
        photoUri: self.photoUri,
        location: loc,
        isVerified: isVerified ?? !!self.isVerified,
        at: Date.now(),
      });
    },
    leave: () => {
      if (presenceChannel) {
        try {
          presenceChannel.untrack();
          supabase.removeChannel(presenceChannel);
        } catch {
          // ignore
        }
        presenceChannel = null;
        lastPresenceState = [];
      }
    },
  };
}

export function subscribePresence(
  cb: (peers: PresencePeer[]) => void,
): () => void {
  presenceListeners.push(cb);
  if (lastPresenceState.length > 0) cb(lastPresenceState);
  return () => {
    presenceListeners = presenceListeners.filter((l) => l !== cb);
  };
}

// How many presence peers are within `radiusKm` of the given point, not
// counting the viewer themselves.
export function countPresenceNearby(
  point: GeoPoint | null,
  excludeUserId: string | null,
  radiusKm = 5,
): number {
  if (!point) return Math.max(0, lastPresenceState.length - 1);
  return lastPresenceState.filter((p) => {
    if (excludeUserId && p.userId === excludeUserId) return false;
    if (!p.location) return false;
    return haversineMeters(point, p.location) <= radiusKm * 1000;
  }).length;
}

export async function broadcastAlert(alert: AlertBroadcast): Promise<void> {
  const channel = ensureBroadcastChannel();
  // Fire-and-forget the FIRST attempt immediately. Supabase drops sends
  // made before SUBSCRIBED, but if prewarmBroadcastChannel ran at launch
  // the channel will already be ready by the time the user presses SOS,
  // so the very first send hits in <100ms.
  if (broadcastChannelReady) {
    try {
      const result = await channel.send({
        type: 'broadcast',
        event: 'new-alert',
        payload: alert,
      });
      console.log('[community] broadcastAlert sent fast', result);
      if (result === 'ok') return;
    } catch (err) {
      console.warn('[community] fast broadcast failed, falling back', err);
    }
  }
  // Cold-path: channel wasn't ready or fast send failed. Wait briefly,
  // then retry. This is the safety net for cases where prewarm hadn't run
  // (e.g. SOS pressed within the first second of app launch).
  const deadline = Date.now() + 5000;
  while (!broadcastChannelReady && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await channel.send({
        type: 'broadcast',
        event: 'new-alert',
        payload: alert,
      });
      console.log('[community] broadcastAlert sent', { attempt, result });
      if (result === 'ok') return;
    } catch (err) {
      console.warn('[community] broadcastAlert attempt failed', attempt, err);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

// Tells every receiver listening on the alerts channel that the SOS with
// the given id should now be considered "expanded" — receivers between
// 2 km and 5 km of the victim will start showing it. Sender fires this
// after 60 s with no responder.
export async function broadcastExpandRadius(sosId: string): Promise<void> {
  const channel = ensureBroadcastChannel();
  try {
    await channel.send({
      type: 'broadcast',
      event: 'expand-radius',
      payload: { id: sosId },
    });
  } catch (err) {
    console.warn('[community] expand-radius broadcast failed', err);
  }
}

export function subscribeToAlerts(handlers: {
  onAlert: (alert: AlertBroadcast) => void;
  onExpand?: (sosId: string) => void;
}): { unsubscribe: () => void } {
  const channel = supabase
    .channel(ALERTS_CHANNEL, {
      config: { broadcast: { ack: false, self: false } },
    })
    .on('broadcast', { event: 'new-alert' }, (msg) => {
      const payload = msg.payload as AlertBroadcast | undefined;
      console.log('[community] alert received', payload?.id);
      if (!payload || !payload.id || !payload.location) return;
      handlers.onAlert(payload);
    })
    .on('broadcast', { event: 'expand-radius' }, (msg) => {
      const payload = msg.payload as { id?: string } | undefined;
      if (!payload?.id) return;
      handlers.onExpand?.(payload.id);
    })
    .subscribe((status) => {
      console.log('[community] subscription status', status);
    });

  return {
    unsubscribe: () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    },
  };
}

// Converts a raw broadcast into a per-viewer CommunityAlert. We do NOT
// filter by distance here — the receiving screen can choose to hide far
// alerts visually, but silent drops at this layer make testing impossible
// (e.g. two devices >2km apart never see each other). Only filter is "not
// my own SOS." If the viewer hasn't shared location, distance is recorded
// as -1 so the UI can decide what to do.
export function alertFromBroadcast(
  broadcast: AlertBroadcast,
  viewer: GeoPoint | null,
  excludeUserId?: string | null,
): CommunityAlert | null {
  if (excludeUserId && broadcast.victim.id === excludeUserId) return null;
  const distance = viewer
    ? haversineMeters(viewer, broadcast.location)
    : -1;
  return {
    id: broadcast.id,
    victim: {
      id: broadcast.victim.id,
      name: broadcast.victim.name || 'Someone nearby',
      photoUri: broadcast.victim.photoUri,
      phone: broadcast.victim.phone ?? '',
    },
    location: broadcast.location,
    distanceMeters: distance,
    etaSeconds: distance > 0 ? Math.round(distance / WALKING_MPS) : 0,
    createdAt: broadcast.createdAt,
    respondersCount: 0,
  };
}

// Best-effort history query. Reads ONLY columns that live on `sos_events`
// itself (no profile join) so it works even if RLS or the profiles table
// isn't set up. The live broadcast is the real source of truth during an
// active emergency; this is a backfill so an alert raised while the
// responder's app was backgrounded doesn't disappear on foreground.
export async function listNearbyAlerts(
  point: GeoPoint,
  radiusKm = 2,
  excludeUserId?: string | null,
): Promise<CommunityAlert[]> {
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('sos_events')
      .select('id, user_id, lat, lng, address, created_at')
      .eq('status', 'active')
      .gte('created_at', since)
      .limit(50);
    if (error) throw error;
    if (!data || data.length === 0) return [];
    return (data as RawAlertRow[])
      .filter((row) => !excludeUserId || row.user_id !== excludeUserId)
      .map((row) => {
        const loc: SOSLocation = {
          latitude: row.lat,
          longitude: row.lng,
          address: row.address,
        };
        const distance = haversineMeters(point, loc);
        return {
          id: row.id,
          victim: {
            id: row.user_id,
            name: 'Someone nearby',
            photoUri: null,
            phone: '',
          },
          location: loc,
          distanceMeters: distance,
          etaSeconds: Math.round(distance / WALKING_MPS),
          createdAt: new Date(row.created_at).getTime(),
          respondersCount: 0,
        };
      })
      .filter((a) => a.distanceMeters <= radiusKm * 1000)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch (err) {
    console.warn('[community] listNearbyAlerts failed', err);
    return [];
  }
}

// Record that the current user is responding to this alert. Best-effort —
// if it fails we still allow the local flow to proceed so the victim isn't
// left waiting on a network hiccup.
export async function respondToAlert(
  alertId: string,
  responder: { userId: string; name: string; photoUri: string | null },
): Promise<void> {
  try {
    const { error } = await supabase.from('sos_responders').insert({
      sos_id: alertId,
      user_id: responder.userId,
      name: responder.name,
      photo_url: responder.photoUri,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[community] respondToAlert failed', err);
  }
}

type RawAlertRow = {
  id: string;
  user_id: string;
  lat: number;
  lng: number;
  address: string | null;
  created_at: string;
};
