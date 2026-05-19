import { secureStorage } from './secure-store';

// Safety PIN — a 4-digit code the user sets once and is asked for to
// cancel an active SOS. Stops an attacker who grabbed the phone from
// silently dismissing the alert.
//
// We deliberately use a separate adapter (SecureStore) instead of the
// AsyncStorage hybrid so the PIN never appears in a plain JSON dump.
// Stored as a non-reversible hash (FNV-1a) — collision-resistant enough
// for a 4-digit space and avoids importing a crypto polyfill just for
// this. The PIN is never sent off the device.

// Prefix routes this key to SecureStore in the hybrid adapter — see
// services/secure-store.ts. The plaintext PIN never touches disk; only
// the hash is persisted, and that hash lives in Android Keystore.
const KEY = 'orbii:secure:safety-pin-hash-v1';

// FNV-1a 32-bit. Small, deterministic, no external dep. Good enough for
// "is this string the same as the one I stored?".
function hash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function isPinSet(): Promise<boolean> {
  try {
    const v = await secureStorage.getItem(KEY);
    return !!v;
  } catch {
    return false;
  }
}

export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');
  await secureStorage.setItem(KEY, hash(pin));
}

export async function clearPin(): Promise<void> {
  await secureStorage.removeItem(KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const stored = await secureStorage.getItem(KEY);
    if (!stored) return false;
    return stored === hash(pin);
  } catch {
    return false;
  }
}
