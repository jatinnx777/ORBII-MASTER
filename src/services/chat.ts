import { supabase } from './supabase';

// Friend-to-friend chat over Supabase Realtime broadcast. No DB writes — the
// channel name is a deterministic sort of (myUsername, friendUsername) so
// both sides land on the same room. Messages are ephemeral; they only flow
// while both users are online and on this channel.
//
// Once a `messages` table exists in Supabase, swap broadcastMessage out for
// an INSERT and the existing UI continues to work without changes.

export type ChatMessageKind = 'text' | 'location';

export type ChatMessage = {
  id: string;
  fromUsername: string;
  toUsername: string;
  body: string;
  kind: ChatMessageKind;
  // Only populated when kind === 'location'.
  latitude?: number;
  longitude?: number;
  createdAt: number;
};

function channelName(a: string, b: string): string {
  const [first, second] = [a, b].sort();
  return `orbii:chat:${first}:${second}`;
}

export type ChatHandle = {
  send: (msg: Omit<ChatMessage, 'id' | 'createdAt'>) => Promise<void>;
  unsubscribe: () => void;
};

// Open a chat room between `me` and `friend`. The callback fires every
// time a message lands on the room. Send via the returned handle.
export function openChat(
  me: string,
  friend: string,
  onMessage: (msg: ChatMessage) => void,
): ChatHandle {
  const name = channelName(me, friend);
  const channel = supabase.channel(name, {
    config: { broadcast: { ack: false, self: false } },
  });

  channel.on('broadcast', { event: 'msg' }, (msg) => {
    const payload = msg.payload as ChatMessage | undefined;
    if (!payload || !payload.id) return;
    // Only deliver messages addressed to me. Self-broadcasts are filtered
    // by `self: false` in the channel config above.
    if (payload.toUsername !== me) return;
    onMessage(payload);
  });

  channel.subscribe();

  return {
    send: async ({ fromUsername, toUsername, body, kind, latitude, longitude }) => {
      const message: ChatMessage = {
        id: `m_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        fromUsername,
        toUsername,
        body,
        kind,
        latitude,
        longitude,
        createdAt: Date.now(),
      };
      try {
        await channel.send({ type: 'broadcast', event: 'msg', payload: message });
      } catch (err) {
        console.warn('[chat] send failed', err);
      }
    },
    unsubscribe: () => {
      try {
        channel.unsubscribe();
      } catch {
        // ignore
      }
    },
  };
}
