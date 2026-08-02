import { NativeModules, NativeEventEmitter, Platform, EmitterSubscription } from 'react-native';
import {
  hasMeshPermissions,
  requestMeshPermissions,
  startMeshListening,
} from './mesh';

/**
 * Offline Bluetooth chat (bitchat-style), FIRST CUT (needs on-device testing).
 *
 * Nearby ORBII phones exchange short text messages directly over Bluetooth LE,
 * with no internet, no accounts, no server. Each message is a small extended
 * advertisement on a dedicated chat channel; phones in range catch it while
 * listening and re-flood it a few hops, so it reaches beyond a single radio's
 * range. This is for a disaster / no-signal context (find people nearby, ask
 * for help), NOT an open stranger-messaging network.
 *
 * Limits of this first cut (honest):
 *  - Needs Bluetooth extended advertising (most phones from ~2018+; older ones
 *    can still receive nothing / send nothing and the UI says so).
 *  - Messages are short (a couple of hundred bytes, trimmed if longer).
 *  - Broadcast, unencrypted, to everyone in range. Do not put anything private
 *    in it. It is a shout across the room, not a private DM.
 */

export type MeshChatMessage = {
  sender: string;
  text: string;
  at: number;
};

const { OrbiiMesh } = NativeModules as {
  OrbiiMesh?: { sendChat(text: string, sender: string): Promise<boolean> };
};

const available = Platform.OS === 'android' && !!OrbiiMesh;

// Cap what we broadcast so it fits one advertisement and can't be abused as a
// firehose. The native side trims too, but we keep the UI honest.
export const MAX_CHAT_LEN = 160;
export const MAX_NAME_LEN = 20;

/**
 * Make sure Bluetooth is permitted and this phone is listening, so chat can both
 * send and receive. Call before opening the chat screen. Prompts if needed.
 */
export async function ensureChatReady(): Promise<boolean> {
  if (!available) return false;
  try {
    let ok = await hasMeshPermissions();
    if (!ok) ok = await requestMeshPermissions();
    if (!ok) return false;
    // Listening puts the radio into scan mode so we actually receive messages.
    await startMeshListening();
    return true;
  } catch {
    return false;
  }
}

/** Broadcast a chat message to nearby phones. Returns false if it couldn't go out. */
export async function sendChatMessage(text: string, sender: string): Promise<boolean> {
  if (!available) return false;
  const body = text.trim().slice(0, MAX_CHAT_LEN);
  if (!body) return false;
  const name = (sender || 'ORBII').trim().slice(0, MAX_NAME_LEN);
  try {
    return await OrbiiMesh!.sendChat(body, name);
  } catch {
    return false;
  }
}

/**
 * Subscribe to chat messages caught over Bluetooth. Returns an unsubscribe fn.
 * The callback fires for every message this phone receives (including relays it
 * re-floods, deduped natively so each message arrives once).
 */
export function subscribeChatMessages(cb: (msg: MeshChatMessage) => void): () => void {
  if (!available) return () => {};
  let sub: EmitterSubscription | null = null;
  try {
    const emitter = new NativeEventEmitter(NativeModules.OrbiiMesh);
    sub = emitter.addListener('OrbiiMeshChat', (e: MeshChatMessage) => {
      if (e && typeof e.text === 'string') cb(e);
    });
  } catch {
    sub = null;
  }
  return () => {
    try {
      sub?.remove();
    } catch {
      // ignore
    }
  };
}

export const chatAvailable = available;
