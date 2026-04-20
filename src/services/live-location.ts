import { supabase } from './supabase';
import type { GeoPoint } from '@/types';

// Live location pub/sub for in-progress SOS responses. Uses Supabase
// Realtime's broadcast channel — no database row per ping, no writes, no
// cost. The responder publishes their GPS every few seconds; the victim's
// device subscribes to the same channel and re-renders the marker.
//
// Fallback: if realtime fails (offline, bad tunnel) we silently no-op —
// the helper still moves toward the victim IRL even if the map doesn't
// update. Safety first, tracking is a nice-to-have.

export type Responder = {
  id: string;
  name: string;
  photoUri: string | null;
  phone: string | null;
};

export type LiveLocationPayload = {
  responder: Responder;
  point: GeoPoint;
  at: number;
};

export type LiveLocationHandle = {
  publish: (point: GeoPoint) => void;
  unsubscribe: () => void;
};

function channelName(sosId: string): string {
  return `sos-live:${sosId}`;
}

export function publishLiveLocation(
  sosId: string,
  responder: Responder,
): LiveLocationHandle {
  const channel = supabase.channel(channelName(sosId), {
    config: { broadcast: { ack: false, self: false } },
  });
  let subscribed = false;
  channel.subscribe((status) => {
    subscribed = status === 'SUBSCRIBED';
  });

  return {
    publish: (point: GeoPoint) => {
      if (!subscribed) return;
      try {
        channel.send({
          type: 'broadcast',
          event: 'pos',
          payload: {
            responder,
            point,
            at: Date.now(),
          } satisfies LiveLocationPayload,
        });
      } catch (err) {
        console.warn('[live-location] publish failed', err);
      }
    },
    unsubscribe: () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // ignore
      }
    },
  };
}

export function subscribeLiveLocation(
  sosId: string,
  onUpdate: (payload: LiveLocationPayload) => void,
): { unsubscribe: () => void } {
  const channel = supabase
    .channel(channelName(sosId), {
      config: { broadcast: { ack: false, self: false } },
    })
    .on('broadcast', { event: 'pos' }, (msg) => {
      const payload = msg.payload as LiveLocationPayload | undefined;
      if (!payload || !payload.point || !payload.responder) return;
      onUpdate(payload);
    })
    .subscribe();

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
