// Base64 moved to utils/base64.ts and is re-exported here so existing
// importers of mesh-crypto keep working.
import nacl from 'tweetnacl';
import sealedbox from 'tweetnacl-sealedbox-js';
import * as Crypto from 'expo-crypto';
import { bytesToB64, b64ToBytes } from '@/utils/base64';

// Seals an SOS payload for the offline mesh. Uses libsodium-compatible sealed
// boxes (anonymous public-key encryption): the app and every relay can only
// SEAL to the server's public key; only the mesh-bridge edge function, holding
// the matching secret, can open it. Relays are blind couriers.

// tweetnacl needs a PRNG; React Native has no global crypto.getRandomValues, so
// we feed it expo-crypto.
nacl.setPRNG((x, n) => {
  const bytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) x[i] = bytes[i];
});

// Server X25519 PUBLIC key (base64). The matching SECRET lives ONLY in the
// Supabase secret MESH_SECRET_KEY, never in the app.
const SERVER_PUBLIC_KEY_B64 = 'H5G8s3SmWB6EMcvpVMr6Dtnrr9XvF3Q/eQIjEm61hEY=';


export function utf8ToBytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) {
      out += String.fromCharCode(c);
    } else if (c >= 0xc0 && c < 0xe0) {
      out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    } else if (c >= 0xe0) {
      out += String.fromCharCode(
        ((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f),
      );
    }
  }
  return out;
}

export type MeshSosPayload = {
  v: number; // schema version
  uid: string; // victim user id
  lat: number;
  lng: number;
  ts: number; // ms epoch
};

/** Seal an SOS payload and mint a 4-byte message id (8 hex chars). */
export function sealSosForMesh(p: MeshSosPayload): { msgId: string; sealed: string } {
  const pub = b64ToBytes(SERVER_PUBLIC_KEY_B64);
  const sealed = sealedbox.seal(utf8ToBytes(JSON.stringify(p)), pub);
  const idBytes = Crypto.getRandomBytes(4);
  let msgId = '';
  for (let i = 0; i < 4; i++) msgId += idBytes[i].toString(16).padStart(2, '0');
  return { msgId, sealed: bytesToB64(sealed) };
}

export { bytesToB64, b64ToBytes };
