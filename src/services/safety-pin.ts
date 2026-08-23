import { secureStorage } from './secure-store';

// Safety PIN, a 4-digit code the user sets once and is asked for to
// cancel an active SOS. Stops an attacker who grabbed the phone from
// silently dismissing the alert.
//
// We deliberately use a separate adapter (SecureStore) instead of the
// AsyncStorage hybrid so the PIN never appears in a plain JSON dump.
// Stored as a non-reversible hash (FNV-1a), collision-resistant enough
// for a 4-digit space and avoids importing a crypto polyfill just for
// this. The PIN is never sent off the device.

// Prefix routes this key to SecureStore in the hybrid adapter, see
// services/secure-store.ts. The plaintext PIN never touches disk; only
// the hash is persisted, and that hash lives in Android Keystore.
//
// The key was 'orbii:secure:safety-pin-hash-v1' until the colons were found
// to be illegal in SecureStore, which meant the hash was never encrypted at
// all: every write threw and fell back to plain AsyncStorage. Renamed to a
// legal key. LEGACY_KEY no longer matches the secure prefix, so reading it
// goes to AsyncStorage, which is exactly where the old hashes ended up.
const KEY = 'orbii_secure_safety_pin_hash_v1';
const LEGACY_KEY = 'orbii:secure:safety-pin-hash-v1';

/**
 * Read the stored hash, moving a pre-rename one into the keystore on the way.
 *
 * Existing users set their PIN under the old key and it is write-once, so
 * without this they would be asked to set a "new" PIN that setPin would then
 * refuse. Migration is best-effort: if the re-write fails we still return the
 * hash, because being unable to re-encrypt is not a reason to lock somebody
 * out of cancelling their own SOS.
 */
async function readHash(): Promise<string | null> {
  const current = await secureStorage.getItem(KEY);
  if (current) return current;

  const legacy = await secureStorage.getItem(LEGACY_KEY);
  if (!legacy) return null;

  try {
    await secureStorage.setItem(KEY, legacy);
    await secureStorage.removeItem(LEGACY_KEY);
  } catch {
    // Keep the legacy copy; we'll try again next launch.
  }
  return legacy;
}

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
    return !!(await readHash());
  } catch {
    return false;
  }
}

/**
 * Set the PIN. WRITE-ONCE by design.
 *
 * The PIN's whole job is to stop an attacker holding the phone from calling off
 * an SOS. If it could be changed from inside the app, that attacker could
 * simply change it, so once set, it is set. It's collected during registration
 * and never again. Enforced here, not in the UI, so no screen can bypass it.
 */
export async function setPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error('PIN must be exactly 4 digits.');
  if (await isPinSet()) {
    throw new Error('Your safety PIN is already set and cannot be changed.');
  }
  await secureStorage.setItem(KEY, hash(pin));
}

/**
 * Only for account deletion / sign-out cleanup, never a user-facing "remove".
 */
export async function clearPin(): Promise<void> {
  await secureStorage.removeItem(KEY);
  await secureStorage.removeItem(LEGACY_KEY);
}

export async function verifyPin(pin: string): Promise<boolean> {
  try {
    const stored = await readHash();
    if (!stored) return false;
    return stored === hash(pin);
  } catch {
    return false;
  }
}
