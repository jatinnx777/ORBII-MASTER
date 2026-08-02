import nacl from 'tweetnacl';
import {
  bytesToB64,
  b64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
} from './mesh-crypto';
import { getMeshIdentity, shortIdOf, type MeshIdentity } from './mesh-identity';
import {
  chatAvailable,
  ensureChatReady,
  sendChatMessage,
  subscribeChatMessages,
  MAX_NAME_LEN,
} from './mesh-chat';

/**
 * The "nearby" layer over the raw Bluetooth chat transport. It carries three
 * kinds of frame on the same channel, and every relay just floods the opaque
 * bytes:
 *   - a plain PUBLIC message (the open room, readable by anyone nearby);
 *   - a PRESENCE beacon (your nickname + public key, so people can find you);
 *   - a DIRECT message, end-to-end encrypted to ONE person's public key.
 *
 * Only the intended recipient can open a direct message (Curve25519 box). Relays
 * and eavesdroppers see ciphertext addressed by a short fingerprint, never the
 * text. Metadata (that two short-ids exchanged something) is NOT hidden; this is
 * a first cut for a no-internet context, not a traffic-analysis-proof network.
 */

export type NearbyPeer = {
  publicB64: string;
  shortId: string;
  nick: string;
  lastSeen: number;
};

export type DirectMessage = {
  fromShortId: string;
  fromPublicB64: string;
  fromNick: string;
  text: string;
  at: number;
};

export type PublicMessage = { sender: string; text: string; at: number };

// Control-frame markers (kept to single bytes so they can't collide with normal
// text, which never starts with \x01).
const P = '\x01P|'; // presence
const D = '\x01D|'; // direct message
const SEP = '|'; // base64 never contains '|', safe as a field separator

// Direct-message plaintext cap: encryption + addressing overhead has to fit one
// Bluetooth advertisement, so DMs are shorter than public messages.
export const MAX_DM_LEN = 70;

const PRESENCE_MS = 6000;
// Drop peers we haven't heard from in a while.
const PEER_TTL_MS = 45000;

type PublicCb = (m: PublicMessage) => void;
type PeerCb = (peers: NearbyPeer[]) => void;
type DmCb = (m: DirectMessage) => void;

const publicSubs = new Set<PublicCb>();
const peerSubs = new Set<PeerCb>();
const dmSubs = new Set<DmCb>();

const peers = new Map<string, NearbyPeer>(); // keyed by shortId

let identity: MeshIdentity | null = null;
let rawUnsub: (() => void) | null = null;
let presenceTimer: ReturnType<typeof setInterval> | null = null;
let myNick = 'Neighbour';
let refCount = 0;

function emitPeers() {
  const now = Date.now();
  for (const [id, p] of peers) if (now - p.lastSeen > PEER_TTL_MS) peers.delete(id);
  const list = [...peers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  peerSubs.forEach((cb) => cb(list));
}

function handleRaw(sender: string, text: string, at: number) {
  if (text.startsWith(P)) {
    // Presence: nickname (from the chat sender field) + public key.
    const publicB64 = text.slice(P.length);
    if (!publicB64) return;
    let pub: Uint8Array;
    try {
      pub = b64ToBytes(publicB64);
    } catch {
      return;
    }
    if (pub.length !== 32) return;
    const shortId = shortIdOf(pub);
    if (identity && shortId === identity.shortId) return; // ignore my own beacon
    peers.set(shortId, { publicB64, shortId, nick: sender || 'Nearby', lastSeen: at });
    emitPeers();
    return;
  }
  if (text.startsWith(D)) {
    if (!identity) return;
    const parts = text.slice(D.length).split(SEP);
    if (parts.length !== 4) return;
    const [fromShortId, toShortId, nonceB64, cipherB64] = parts;
    if (toShortId !== identity.shortId) return; // not addressed to me
    const peer = peers.get(fromShortId);
    if (!peer) return; // sender not discovered yet, can't verify/decrypt
    try {
      const opened = nacl.box.open(
        b64ToBytes(cipherB64),
        b64ToBytes(nonceB64),
        b64ToBytes(peer.publicB64),
        identity.secretKey,
      );
      if (!opened) return;
      const msg: DirectMessage = {
        fromShortId,
        fromPublicB64: peer.publicB64,
        fromNick: peer.nick,
        text: bytesToUtf8(opened),
        at,
      };
      dmSubs.forEach((cb) => cb(msg));
    } catch {
      // wrong key / corrupt frame; drop
    }
    return;
  }
  // Anything else is a plain public message.
  publicSubs.forEach((cb) => cb({ sender: sender || 'Nearby', text, at }));
}

/** Start the nearby layer (idempotent, reference-counted). Returns success. */
export async function startNearby(nick: string): Promise<boolean> {
  myNick = (nick || 'Neighbour').slice(0, MAX_NAME_LEN);
  if (!chatAvailable) return false;
  identity = await getMeshIdentity();
  const ready = await ensureChatReady();
  refCount += 1;
  if (!rawUnsub) {
    rawUnsub = subscribeChatMessages((m) => handleRaw(m.sender, m.text, m.at));
  }
  if (!presenceTimer && ready) {
    const beacon = () => {
      if (identity) sendChatMessage(P + identity.publicB64, myNick).catch(() => {});
    };
    beacon();
    presenceTimer = setInterval(beacon, PRESENCE_MS);
  }
  return ready;
}

/** Stop the nearby layer when the last screen using it goes away. */
export function stopNearby() {
  refCount = Math.max(0, refCount - 1);
  if (refCount > 0) return;
  if (presenceTimer) {
    clearInterval(presenceTimer);
    presenceTimer = null;
  }
  if (rawUnsub) {
    rawUnsub();
    rawUnsub = null;
  }
}

export function setNearbyNick(nick: string) {
  myNick = (nick || 'Neighbour').slice(0, MAX_NAME_LEN);
}

export function getPeers(): NearbyPeer[] {
  return [...peers.values()].sort((a, b) => b.lastSeen - a.lastSeen);
}

export function getMyShortId(): string {
  return identity?.shortId ?? '';
}

/** Broadcast a plain public message to everyone nearby. */
export async function sendPublicMessage(text: string): Promise<boolean> {
  const body = text.trim();
  if (!body || body.startsWith('\x01')) return false;
  return sendChatMessage(body, myNick);
}

/** Send an end-to-end encrypted message to one peer's public key. */
export async function sendDirectMessage(peerPublicB64: string, text: string): Promise<boolean> {
  if (!identity) return false;
  const body = text.trim().slice(0, MAX_DM_LEN);
  if (!body) return false;
  let peerPub: Uint8Array;
  try {
    peerPub = b64ToBytes(peerPublicB64);
  } catch {
    return false;
  }
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(utf8ToBytes(body), nonce, peerPub, identity.secretKey);
  const frame =
    D +
    identity.shortId +
    SEP +
    shortIdOf(peerPub) +
    SEP +
    bytesToB64(nonce) +
    SEP +
    bytesToB64(box);
  // Neutral sender so relays don't see who is DMing; the recipient recovers the
  // nickname from the sender's short-id.
  return sendChatMessage(frame, 'lock');
}

export function onPublicMessage(cb: PublicCb): () => void {
  publicSubs.add(cb);
  return () => publicSubs.delete(cb);
}

export function onPeers(cb: PeerCb): () => void {
  peerSubs.add(cb);
  cb(getPeers());
  return () => peerSubs.delete(cb);
}

export function onDirectMessage(cb: DmCb): () => void {
  dmSubs.add(cb);
  return () => dmSubs.delete(cb);
}

export const nearbyAvailable = chatAvailable;
