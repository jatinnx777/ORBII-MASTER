import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Consent for acting as an offline relay for OTHER people.
 *
 * DPDP Act 2023 §6(4): a Data Principal has the right to withdraw consent at
 * any time, and withdrawing it must be as easy as giving it. Relaying is the
 * one thing ORBII does with somebody else's personal data on this user's
 * device, so it is the one thing that needs a switch.
 *
 * WHAT THIS DOES AND DOES NOT GATE, precisely, because getting this wrong
 * would be dangerous rather than merely non-compliant:
 *
 *   GATED   — listening for, carrying, and forwarding OTHER people's sealed
 *             emergency packets. This is the third-party processing the Act is
 *             concerned with, and it is what the user is consenting to.
 *
 *   NEVER   — this user's OWN outgoing SOS. armMeshSos and armOfflineSos are
 *   GATED     untouched. Turning relaying off is a statement about carrying
 *             other people's traffic, not a request to be left without help,
 *             and no privacy setting in this app is ever allowed to make its
 *             owner less safe.
 *
 * The stored value is the string 'true' or 'false' under a plain key rather
 * than JSON, so it can be read and reasoned about from adb during a support
 * call without a parser.
 */

/** Storage key. Plain, on purpose: this is a setting a support engineer reads. */
export const MESH_RELAY_KEY = 'enable_mesh_relay';

/**
 * Default ON.
 *
 * The mesh only works if enough phones carry for each other, and a relay
 * network that ships off by default is a relay network that does not exist.
 * The packet a phone carries is sealed with a key it does not hold, so the
 * cost of leaving it on is battery, not exposure.
 *
 * That is the reasoning, and it is a product decision rather than a legal
 * conclusion. It relies on the disclosure actually being made: see
 * LEGAL_ADDENDUM.md §1. Default-on without disclosure is not defensible, and
 * this constant should flip to false if that clause is not published.
 */
const DEFAULT_ENABLED = true;

/** Cached so the SOS path never awaits storage. Null until first read. */
let cached: boolean | null = null;

export async function isMeshRelayEnabled(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const raw = await AsyncStorage.getItem(MESH_RELAY_KEY);
    cached = raw === null ? DEFAULT_ENABLED : raw === 'true';
  } catch {
    // Storage unavailable. Fail to the default rather than silently disabling
    // a safety feature because a read failed.
    cached = DEFAULT_ENABLED;
  }
  return cached;
}

/**
 * Synchronous read for hot paths that cannot await.
 *
 * Returns the default until the first async read has completed, so call
 * isMeshRelayEnabled() once at boot to warm it.
 */
export function isMeshRelayEnabledSync(): boolean {
  return cached ?? DEFAULT_ENABLED;
}

export async function setMeshRelayEnabled(enabled: boolean): Promise<void> {
  cached = enabled;
  try {
    await AsyncStorage.setItem(MESH_RELAY_KEY, enabled ? 'true' : 'false');
  } catch {
    // The in-memory value still holds for this session, so the user's choice
    // is honoured now even if it does not survive a restart.
  }
}

/** Test seam. */
export function __resetMeshRelayCache(): void {
  cached = null;
}
