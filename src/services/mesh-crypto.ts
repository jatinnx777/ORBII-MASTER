import nacl from 'tweetnacl';
import sealedbox from 'tweetnacl-sealedbox-js';
import * as Crypto from 'expo-crypto';

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

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let val = 0;
  let p = 0;
  for (let i = 0; i < clean.length; i++) {
    val = (val << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (val >> bits) & 0xff;
    }
  }
  return out;
}

function utf8ToBytes(str: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return Uint8Array.from(out);
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
