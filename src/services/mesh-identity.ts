import nacl from 'tweetnacl';
import * as SecureStore from 'expo-secure-store';
import { bytesToB64, b64ToBytes } from './mesh-crypto'; // importing also sets nacl's PRNG

// This phone's long-term encryption identity for offline 1-to-1 DMs.
//
// A Curve25519 keypair generated once and kept on the device. The PUBLIC key is
// your address on the mesh (others encrypt to it); the SECRET key never leaves
// the phone (stored in the OS keystore via expo-secure-store). Two people who
// have each other's public key can exchange messages that only the two of them
// can read, even though every relay in between just carries opaque bytes.

const SK_KEY = 'orbii.mesh.identity.sk';
const PK_KEY = 'orbii.mesh.identity.pk';

export type MeshIdentity = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicB64: string;
  // Short fingerprint (first 8 bytes of the public key, hex) used to address and
  // look up peers compactly inside a tiny Bluetooth packet.
  shortId: string;
};

let cached: MeshIdentity | null = null;

export function shortIdOf(publicKey: Uint8Array): string {
  let s = '';
  for (let i = 0; i < 8 && i < publicKey.length; i++) s += publicKey[i].toString(16).padStart(2, '0');
  return s;
}

/** Load the device identity, generating and persisting one on first use. */
export async function getMeshIdentity(): Promise<MeshIdentity> {
  if (cached) return cached;
  try {
    const skB64 = await SecureStore.getItemAsync(SK_KEY);
    const pkB64 = await SecureStore.getItemAsync(PK_KEY);
    if (skB64 && pkB64) {
      const secretKey = b64ToBytes(skB64);
      const publicKey = b64ToBytes(pkB64);
      cached = { publicKey, secretKey, publicB64: pkB64, shortId: shortIdOf(publicKey) };
      return cached;
    }
  } catch {
    // keystore read failed; fall through and mint a fresh identity
  }
  const kp = nacl.box.keyPair();
  const publicB64 = bytesToB64(kp.publicKey);
  try {
    await SecureStore.setItemAsync(SK_KEY, bytesToB64(kp.secretKey));
    await SecureStore.setItemAsync(PK_KEY, publicB64);
  } catch {
    // couldn't persist; identity will regenerate next launch (DMs still work this session)
  }
  cached = {
    publicKey: kp.publicKey,
    secretKey: kp.secretKey,
    publicB64,
    shortId: shortIdOf(kp.publicKey),
  };
  return cached;
}
