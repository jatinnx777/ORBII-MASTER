import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { GeoPoint } from '@/types';
import {
  resolveEpoch,
  topicFor,
  watchEpoch,
  type SosChannelKind,
} from './sos-channel';

// Live location pub/sub for in-progress SOS responses. Uses Supabase
// Realtime's broadcast channel, no database row per ping, no writes, no
// cost. The responder publishes their GPS every few seconds; the victim's
// device subscribes to the same channel and re-renders the marker.
//
// Fallback: if realtime fails (offline, bad tunnel) we silently no-op , 
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
  // true when the helper taps "I've reached", the victim is then asked to
  // confirm, and confirming resolves the SOS.
  arrived?: boolean;
};

export type LiveLocationHandle = {
  publish: (point: GeoPoint) => void;
  announceArrived: (point: GeoPoint) => void;
  unsubscribe: () => void;
};


// ── Epoch-aware channel plumbing ──────────────────────────────────────────
// A removed circle member's socket stays open after they lose access, because
// Realtime authorises at JOIN time (sql/88 explains this at length). The epoch
// in the topic is how the conversation moves somewhere they cannot follow.
//
// THE CHANNEL OPENS SYNCHRONOUSLY, ON THE CACHED EPOCH, BEFORE THE LOOKUP
// RETURNS. An SOS must never wait on a network round trip to start streaming a
// position. The epoch is resolved immediately afterwards and the channel hops if
// it moved, so the security tightens a moment after the stream is already up
// rather than delaying it.
type HoppingChannel = {
  /** The live channel, or null between a hop being started and finished. */
  channel: () => RealtimeChannel | null;
  ready: () => boolean;
  close: () => void;
};

function openHoppingChannel(
  kind: SosChannelKind,
  sosId: string,
  bind: (channel: RealtimeChannel) => RealtimeChannel,
): HoppingChannel {
  let epoch = 0;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let closed = false;
  let stopWatch: (() => void) | null = null;

  const join = (next: number) => {
    if (closed) return;
    const previous = channel;
    epoch = next;
    subscribed = false;
    // config.private keeps Realtime Authorization in play; without it the topic
    // is public and sql/39 never runs.
    const fresh = bind(
      supabase.channel(topicFor(kind, sosId, next), {
        config: { private: true, broadcast: { ack: false, self: false } },
      }),
    );
    channel = fresh;
    fresh.subscribe((status) => {
      subscribed = status === 'SUBSCRIBED';
      // Only tear the old channel down once the new one is actually up, so a
      // failed hop leaves us on a working topic instead of no topic at all.
      if (subscribed && previous) {
        try {
          void supabase.removeChannel(previous);
        } catch {
          // ignore
        }
      }
    });
  };

  join(0);

  void resolveEpoch(sosId).then((found) => {
    if (closed) return;
    if (found !== epoch) join(found);
    stopWatch = watchEpoch(sosId, found, (next) => join(next));
  });

  return {
    channel: () => channel,
    ready: () => subscribed,
    close: () => {
      closed = true;
      stopWatch?.();
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
      channel = null;
    },
  };
}

export function publishLiveLocation(
  sosId: string,
  responder: Responder,
): LiveLocationHandle {
  const hop = openHoppingChannel('sos-live', sosId, (c) => c);

  const send = (point: GeoPoint, arrived: boolean) => {
    const channel = hop.channel();
    if (!channel || !hop.ready()) return;
    try {
      channel.send({
        type: 'broadcast',
        event: 'pos',
        payload: { responder, point, at: Date.now(), arrived } satisfies LiveLocationPayload,
      });
    } catch (err) {
      console.warn('[live-location] publish failed', err);
    }
  };

  return {
    publish: (point: GeoPoint) => send(point, false),
    announceArrived: (point: GeoPoint) => send(point, true),
    unsubscribe: () => hop.close(),
  };
}

// ── Victim → helper stream ────────────────────────────────────────────────
// A separate topic so the two directions never share a channel (Supabase
// realtime allows one channel per topic per client). The victim's device
// publishes its live position here during an active SOS; the responder's
// tracking screen subscribes so a MOVING victim is followed, not a stale pin.
export type VictimLocationPayload = { point: GeoPoint; at: number };

export type VictimPublishHandle = {
  publish: (point: GeoPoint) => void;
  unsubscribe: () => void;
};

export function publishVictimLocation(sosId: string): VictimPublishHandle {
  const hop = openHoppingChannel('sos-victim', sosId, (c) => c);
  return {
    publish: (point: GeoPoint) => {
      const channel = hop.channel();
      if (!channel || !hop.ready()) return;
      try {
        channel.send({
          type: 'broadcast',
          event: 'vpos',
          payload: { point, at: Date.now() } satisfies VictimLocationPayload,
        });
      } catch (err) {
        console.warn('[live-location] victim publish failed', err);
      }
    },
    unsubscribe: () => hop.close(),
  };
}

export function subscribeVictimLocation(
  sosId: string,
  onUpdate: (payload: VictimLocationPayload) => void,
): { unsubscribe: () => void } {
  // The handler is re-bound on every hop, which is why bind takes the channel
  // and returns it rather than the caller wiring it up once outside.
  const hop = openHoppingChannel('sos-victim', sosId, (c) =>
    c.on('broadcast', { event: 'vpos' }, (msg) => {
      const payload = msg.payload as VictimLocationPayload | undefined;
      if (!payload?.point) return;
      onUpdate(payload);
    }),
  );
  return { unsubscribe: () => hop.close() };
}

export function subscribeLiveLocation(
  sosId: string,
  onUpdate: (payload: LiveLocationPayload) => void,
): { unsubscribe: () => void } {
  const hop = openHoppingChannel('sos-live', sosId, (c) =>
    c.on('broadcast', { event: 'pos' }, (msg) => {
      const payload = msg.payload as LiveLocationPayload | undefined;
      if (!payload || !payload.point || !payload.responder) return;
      onUpdate(payload);
    }),
  );

  return { unsubscribe: () => hop.close() };
}
