/**
 * Base64 with no dependencies.
 *
 * Lives here rather than inside mesh-crypto.ts because two very different
 * callers need it and only one of them needs cryptography. mesh-crypto pulls in
 * tweetnacl and expo-crypto; the offline SMS encoder needs neither, and making
 * it import them would drag native module initialisation onto the SOS path and
 * make the encoder untestable without a device.
 *
 * Hermes has no atob/btoa and no Buffer, so this is hand-rolled.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes: Uint8Array): string {
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

export function b64ToBytes(b64: string): Uint8Array {
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
