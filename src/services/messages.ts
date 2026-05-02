import { supabase } from './supabase';

// Persistent direct-message store. The `messages` table has columns:
// id, sender_id, receiver_id, message, created_at. Location shares are
// encoded into the message text as a Google Maps URL — the chat UI
// detects the URL and renders a location bubble.
//
// SQL schema lives in sql/01_friend_system.sql.

export type ChatMessage = {
  id: string;
  senderId: string;
  receiverId: string;
  message: string;
  createdAt: number;
};

type MessageRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  message: string;
  created_at: string;
};

function rowToMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    senderId: row.sender_id,
    receiverId: row.receiver_id,
    message: row.message,
    createdAt: Date.parse(row.created_at),
  };
}

// Fetch the last `limit` messages between the two users, ordered ASC so
// the chat list renders newest at bottom without an extra reverse step.
export async function fetchRecentMessages(
  userId: string,
  otherId: string,
  limit = 50,
): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_id.eq.${userId},receiver_id.eq.${otherId}),` +
        `and(sender_id.eq.${otherId},receiver_id.eq.${userId})`,
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return (data as MessageRow[]).map(rowToMessage).reverse();
}

export async function sendMessage(
  senderId: string,
  receiverId: string,
  message: string,
): Promise<ChatMessage | null> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      sender_id: senderId,
      receiver_id: receiverId,
      message,
    })
    .select('*')
    .single<MessageRow>();
  if (error || !data) {
    console.warn('[messages] send failed', error?.message);
    return null;
  }
  return rowToMessage(data);
}

export type MessagesHandle = {
  unsubscribe: () => void;
};

// Listen to INSERTs and forward only those that belong to the user pair.
export function subscribeMessages(
  userId: string,
  otherId: string,
  callback: (msg: ChatMessage) => void,
): MessagesHandle {
  const channel = supabase
    .channel(`messages:${[userId, otherId].sort().join(':')}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      (payload) => {
        const row = payload.new as MessageRow | undefined;
        if (!row) return;
        const isPair =
          (row.sender_id === userId && row.receiver_id === otherId) ||
          (row.sender_id === otherId && row.receiver_id === userId);
        if (!isPair) return;
        callback(rowToMessage(row));
      },
    )
    .subscribe();

  return {
    unsubscribe: () => {
      try {
        channel.unsubscribe();
      } catch {
        // ignore
      }
    },
  };
}

// Helpers for encoding/decoding location shares inside the plain-text
// `message` column. We use a Google Maps URL so the payload is universal
// and human-readable in any other client.
const MAPS_RE =
  /https?:\/\/(?:www\.)?(?:maps\.google\.com|google\.com\/maps|maps\.app\.goo\.gl)[^\s]*[?&]q=(-?\d+\.?\d*),(-?\d+\.?\d*)/i;

export function encodeLocationMessage(
  latitude: number,
  longitude: number,
  caption?: string,
): string {
  const url = `https://maps.google.com/?q=${latitude},${longitude}`;
  return caption ? `${caption} ${url}` : url;
}

export function parseLocation(
  text: string,
): { latitude: number; longitude: number; caption: string } | null {
  const match = text.match(MAPS_RE);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return {
    latitude: lat,
    longitude: lng,
    caption: text.replace(match[0], '').trim(),
  };
}
