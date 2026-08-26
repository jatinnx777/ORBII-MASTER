import { DeviceEventEmitter, NativeModules } from 'react-native';
import { getItem, setItem } from './storage';
import { getConnection, subscribeConnection } from './net';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

/**
 * Store and forward for mesh SOS packets that could not be bridged.
 *
 * THIS IS NOT A SECOND BLE STACK, DELIBERATELY.
 *
 * ORBII already has a working offline mesh: services/mesh.ts, mesh-crypto.ts and
 * the native OrbiiMeshService.kt, which advertises, scans, relays with a TTL,
 * and POSTs to the mesh-bridge edge function. Adding a second advertiser would
 * put two BLE stacks on one radio, and Android gives you a small, hardware
 * dependent number of concurrent advertising sets. They would starve each other
 * and the failure would look like "the mesh is flaky" rather than a conflict.
 *
 * THE ACTUAL HOLE IS HERE, in OrbiiMeshService.kt tryBridge:
 *
 *     } catch (e: Exception) {
 *       // No internet on this phone (expected for most relays) - someone else bridges.
 *     }
 *
 * The packet is dropped. The comment's assumption is that somebody else in range
 * has internet, and usually one does. But if nobody does, an SOS that physically
 * reached a stranger's phone dies on it, and the relay that caught it will very
 * often walk into wifi four minutes later carrying the answer and not know.
 *
 * This is that buffer. It holds the SEALED blob, never plaintext, and pushes it
 * the moment the phone has a connection.
 *
 * WHY THE PAYLOAD IS NOT [VictimID, Lat, Lng, Timestamp] AS SPECIFIED. That
 * layout is plaintext. Broadcast over BLE it hands anybody with a scanner the
 * identity and live position of every woman firing an SOS in range, which builds
 * a stalking tool out of a rescue network. mesh-crypto.ts already seals to the
 * server's public key with crypto_box_seal: relays carry ciphertext they cannot
 * read, and only the mesh-bridge function holds the secret. The vault stores
 * exactly what the mesh already carries and never learns what is inside.
 *
 * TWO WAYS A PACKET GETS IN. The native service broadcasts OrbiiMeshUnbridged
 * the moment an upload fails, which is the fast path while the app is alive. It
 * ALSO writes to MeshVault (Kotlin) first, because Android will keep a
 * foreground service running while tearing down the React Native instance, and
 * an emit into a dead bridge reaches nobody. drainNativeVault() picks those up
 * on next launch. Belt and braces, because the thing being dropped is somebody's
 * emergency.
 */

type NativeVaultEntry = { msgId: string; sealed: string; heldSince: number };

type OrbiiMeshNativeModule = {
  readVault?(): Promise<NativeVaultEntry[]>;
  ackVault?(msgIds: string[]): Promise<number>;
  vaultSize?(): Promise<number>;
  getConstants?(): unknown;
};

/**
 * Looked up on every call, never captured at import time.
 *
 * `const m = NativeModules.OrbiiMesh` at module scope resolves once, when this
 * file is first imported. Under the new architecture a TurboModule is created on
 * first property access, so importing this early enough would bind undefined and
 * the vault would stay permanently deaf to native, with no error anywhere. The
 * lookup is a property read on an object; doing it per call costs nothing.
 */
function nativeModule(): OrbiiMeshNativeModule | undefined {
  return (NativeModules as { OrbiiMesh?: OrbiiMeshNativeModule }).OrbiiMesh;
}

const VAULT_KEY = 'orbii_mesh_vault_v1';

/**
 * The bounds come from MeshVault.kt, which is the single source of truth.
 *
 * WHY NATIVE OWNS THEM. Both sides enforce these numbers, and a packet is first
 * written on the Kotlin side before any JS is guaranteed to be running. Two
 * independent copies of a number that must agree is drift waiting to happen:
 * raise the cap in Kotlin alone and the native store holds 200 while JS quietly
 * discards half of them on the next drain, which on this product means throwing
 * away somebody's emergency and logging nothing.
 *
 * These literals are the LAST RESORT, not a second definition. They apply only
 * where the native module genuinely does not exist: unit tests, and iOS if it is
 * ever built. In __DEV__ a disagreement is reported rather than absorbed, so
 * drift is visible while somebody is looking at it.
 */
const FALLBACK_MAX_ENTRIES = 100;
const FALLBACK_TTL_MS = 21_600_000; // six hours

/** Give up on a packet after this many failed attempts. JS-only, so JS owns it. */
export const MAX_ATTEMPTS = 12;

export type VaultLimits = { maxEntries: number; ttlMs: number; fromNative: boolean };

let cachedLimits: VaultLimits | null = null;

function readNativeConstants(): Record<string, unknown> {
  const mod = nativeModule();
  if (!mod) return {};
  try {
    // New architecture exposes getConstants() as a callable method. The legacy
    // bridge instead merges the map onto the module object itself. Both shapes
    // are checked because which one you get depends on the interop layer, not on
    // anything this file controls.
    if (typeof mod.getConstants === 'function') {
      const c = mod.getConstants();
      if (c && typeof c === 'object') return c as Record<string, unknown>;
    }
  } catch {
    // Fall through to reading properties directly.
  }
  return mod as unknown as Record<string, unknown>;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolved once, then cached.
 *
 * Not resolved at module load: under the new architecture a TurboModule is
 * created on first access, and importing this file during early startup could
 * otherwise freeze the fallbacks in before the native side exists.
 */
export function vaultLimits(): VaultLimits {
  if (cachedLimits) return cachedLimits;

  const constants = readNativeConstants();
  const nativeMax = positiveNumber(constants.VAULT_MAX_ENTRIES);
  const nativeTtl = positiveNumber(constants.VAULT_TTL_MS);

  const limits: VaultLimits = {
    maxEntries: nativeMax ?? FALLBACK_MAX_ENTRIES,
    ttlMs: nativeTtl ?? FALLBACK_TTL_MS,
    fromNative: nativeMax !== null && nativeTtl !== null,
  };

  // typeof guard, not a bare __DEV__. It is a React Native global injected by
  // Metro and it does not exist in the Node test environment, where a bare
  // reference is a ReferenceError, not undefined. TypeScript will not catch this
  // because the RN types declare it globally.
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  if (dev && limits.fromNative) {
    if (nativeMax !== FALLBACK_MAX_ENTRIES || nativeTtl !== FALLBACK_TTL_MS) {
      // Native still wins. This is a nudge to update the literals so the two
      // agree, because the fallbacks are what tests and iOS will use.
      console.warn(
        `[vault] fallback constants have drifted from MeshVault.kt: ` +
          `maxEntries ${FALLBACK_MAX_ENTRIES} vs ${nativeMax}, ` +
          `ttlMs ${FALLBACK_TTL_MS} vs ${nativeTtl}`,
      );
    }
  }

  cachedLimits = limits;
  return limits;
}

/** Test seam. Forces the next vaultLimits() to re-read the native module. */
export function resetVaultLimits(): void {
  cachedLimits = null;
}

export type VaultEntry = {
  /** Mesh message id. The dedupe key end to end. */
  msgId: string;
  /** Sealed ciphertext, base64. Opaque here, by design. */
  sealed: string;
  /** When this phone caught it. */
  heldSince: number;
  attempts: number;
  lastAttemptAt: number | null;
};

type Vault = { entries: VaultEntry[] };

const EMPTY: Vault = { entries: [] };

async function read(): Promise<Vault> {
  try {
    // storage.getItem already parses and swallows its own errors, returning
    // null. It cannot know the SHAPE is right, which is what the filter below
    // is for.
    const parsed = await getItem<Vault>(VAULT_KEY);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    // Validate each entry. Corrupt storage must not take the flush down with it,
    // because the flush is what delivers somebody's emergency.
    const entries = parsed.entries.filter(
      (e): e is VaultEntry =>
        !!e &&
        typeof e.msgId === 'string' &&
        e.msgId.length > 0 &&
        typeof e.sealed === 'string' &&
        e.sealed.length > 0 &&
        typeof e.heldSince === 'number' &&
        Number.isFinite(e.heldSince),
    );
    return { entries };
  } catch (err) {
    console.warn('[vault] unreadable, starting empty', err);
    return { entries: [] };
  }
}

async function write(vault: Vault): Promise<void> {
  try {
    await setItem(VAULT_KEY, vault);
  } catch (err) {
    console.warn('[vault] could not persist', err);
  }
}

function prune(entries: VaultEntry[], now: number): VaultEntry[] {
  const { maxEntries, ttlMs } = vaultLimits();
  const live = entries.filter((e) => now - e.heldSince < ttlMs && e.attempts < MAX_ATTEMPTS);
  // Oldest first, so the slice keeps the newest when over capacity. A fresher
  // emergency is the one still worth relaying.
  live.sort((a, b) => a.heldSince - b.heldSince);
  return live.length > maxEntries ? live.slice(live.length - maxEntries) : live;
}

/**
 * Hold a sealed packet for later delivery.
 *
 * Idempotent on msgId: the mesh floods, so the same packet legitimately arrives
 * several times and must be stored once. Returns false when it was already held.
 */
export async function vaultHold(msgId: string, sealed: string): Promise<boolean> {
  if (!msgId || !sealed) return false;
  try {
    const now = Date.now();
    const vault = await read();
    if (vault.entries.some((e) => e.msgId === msgId)) return false;

    const entries = prune(
      [...vault.entries, { msgId, sealed, heldSince: now, attempts: 0, lastAttemptAt: null }],
      now,
    );
    await write({ entries });
    return true;
  } catch (err) {
    console.warn('[vault] hold failed', err);
    return false;
  }
}

/** Everything currently held. Sealed, so this reveals nothing about anybody. */
export async function vaultPeek(): Promise<VaultEntry[]> {
  const vault = await read();
  return prune(vault.entries, Date.now());
}

export async function vaultSize(): Promise<number> {
  return (await vaultPeek()).length;
}

/**
 * How many packets the NATIVE store is holding.
 *
 * Distinct from vaultSize(), which counts the JS side. During hardware testing
 * they answer different questions: native survives an app kill, JS does the
 * flushing, and a packet moves from one to the other on drain. A test that only
 * looked at one would miss the handover entirely.
 */
export async function nativeVaultSize(): Promise<number> {
  const mod = nativeModule();
  if (!mod?.vaultSize) return 0;
  try {
    return await mod.vaultSize();
  } catch {
    return 0;
  }
}

/**
 * Both counts and where the limits came from, as one line for logcat.
 *
 * This exists because the vault is otherwise invisible: it has no screen, and
 * the whole feature is verified by watching a number go 0, 1, 0 across an
 * airplane-mode cycle. Without this you are testing by faith.
 */
export async function vaultStatusLine(): Promise<string> {
  const limits = vaultLimits();
  const [js, native] = await Promise.all([vaultSize(), nativeVaultSize()]);
  return (
    `[vault] js=${js} native=${native} ` +
    `cap=${limits.maxEntries} ttlMs=${limits.ttlMs} fromNative=${limits.fromNative}`
  );
}

export async function vaultClear(): Promise<void> {
  await write(EMPTY);
}

/**
 * Move anything the native service stored into the JS vault.
 *
 * ORDER MATTERS AND IS NOT NEGOTIABLE: hold first, acknowledge second. Reading
 * does not clear the native store, so a crash between the two costs us a
 * duplicate delivery, which the bridge deduplicates. Acknowledging first would
 * cost us the packet, which nothing recovers.
 *
 * Returns how many were taken over. Never throws.
 */
export async function drainNativeVault(): Promise<number> {
  const mod = nativeModule();
  if (!mod?.readVault) return 0;
  try {
    const entries = await mod.readVault();
    if (!Array.isArray(entries) || entries.length === 0) return 0;

    const taken: string[] = [];
    for (const e of entries) {
      if (!e?.msgId || !e?.sealed) continue;
      // vaultHold returns false for a duplicate. Still acknowledged: a packet
      // already in the JS vault is one the native side can stop carrying.
      await vaultHold(e.msgId, e.sealed);
      taken.push(e.msgId);
    }

    if (taken.length > 0) {
      await mod.ackVault?.(taken)?.catch(() => 0);
      console.log(`[vault] drained ${taken.length} packet(s) from the native store`);
    }
    return taken.length;
  } catch (err) {
    console.warn('[vault] could not drain the native store', err);
    return 0;
  }
}

function bridgeUrl(): string {
  return `${SUPABASE_URL}/functions/v1/mesh-bridge`;
}

/**
 * POST one packet. Resolves true only on a 2xx.
 *
 * A 4xx is treated as delivered on purpose. The usual 4xx here is the bridge
 * rejecting a duplicate it already has, which means the SOS arrived by another
 * route: the packet's job is done and retrying it forever is noise. Only a
 * network error or a 5xx is worth carrying.
 */
async function postOne(entry: VaultEntry, signal: AbortSignal): Promise<boolean> {
  const res = await fetch(bridgeUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ msgId: entry.msgId, sealed: entry.sealed }),
    signal,
  });
  if (res.ok) return true;
  return res.status >= 400 && res.status < 500;
}

export type FlushResult = {
  attempted: number;
  delivered: number;
  remaining: number;
  skippedOffline: boolean;
};

let flushing = false;

/**
 * Try to deliver everything held.
 *
 * Single-flight: connectivity changes arrive in bursts and App foreground can
 * fire alongside them, so without the guard the same packet is POSTed several
 * times concurrently and the attempt counter burns down for no reason.
 *
 * Never throws.
 */
export async function flushVault(): Promise<FlushResult> {
  const base: FlushResult = { attempted: 0, delivered: 0, remaining: 0, skippedOffline: false };
  if (flushing) return base;
  flushing = true;

  try {
    const online = await getConnection().catch(() => ({ isConnected: false, type: 'unknown' }));
    if (!online.isConnected) {
      const held = await vaultPeek();
      return { ...base, remaining: held.length, skippedOffline: true };
    }

    const now = Date.now();
    const vault = await read();
    let entries = prune(vault.entries, now);
    if (entries.length === 0) {
      await write({ entries });
      return base;
    }

    const survivors: VaultEntry[] = [];
    const deliveredIds: string[] = [];
    let delivered = 0;
    let attempted = 0;

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const controller = new AbortController();
      // Per-request deadline. fetch on React Native has no default timeout, and
      // a hung socket on a captive-portal wifi would otherwise stall the whole
      // flush behind one packet.
      const timer = setTimeout(() => controller.abort(), 10_000);
      attempted += 1;
      try {
        const ok = await postOne(entry, controller.signal);
        if (ok) {
          delivered += 1;
          deliveredIds.push(entry.msgId);
        } else {
          survivors.push({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now });
        }
      } catch {
        // THE NETWORK DIED. Stop, which is what the comment here always claimed
        // and the code never did.
        //
        // Continuing charged an attempt to every remaining packet against a
        // connection already known to be down. initVaultAutoFlush runs on each
        // isConnected transition, and a flapping campus wifi produces many per
        // minute, so MAX_ATTEMPTS was reached in minutes and prune() deleted
        // other people's emergencies silently.
        //
        // The in-flight packet earns its attempt; the untried ones carry over
        // untouched.
        survivors.push({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now });
        survivors.push(...entries.slice(i + 1));
        break;
      } finally {
        // Runs on the break too, so the aborted request's timer is cleared.
        clearTimeout(timer);
      }
    }

    // RE-READ BEFORE WRITING. vaultHold may have landed during the loop above,
    // which on a slow link is tens of seconds, and it is driven by the native
    // OrbiiMeshUnbridged event that fires exactly when the mesh is busy. The
    // previous blind write erased those packets with no error and no log.
    //
    // Merge order matters: survivors are applied AFTER latest, so an entry we
    // just attempted keeps its incremented count rather than being reverted by
    // the copy that was on disk when the flush started.
    const latest = await read();
    const byId = new Map<string, VaultEntry>();
    for (const e of latest.entries) byId.set(e.msgId, e);
    for (const sv of survivors) byId.set(sv.msgId, sv);
    // Anything genuinely delivered must not be resurrected by the re-read.
    for (const id of deliveredIds) byId.delete(id);

    entries = prune([...byId.values()], now);
    await write({ entries });
    if (attempted > 0) {
      console.log(
        `[vault] flush attempted=${attempted} delivered=${delivered} remaining=${entries.length}`,
      );
    }
    return { attempted, delivered, remaining: entries.length, skippedOffline: false };
  } catch (err) {
    console.warn('[vault] flush failed', err);
    return base;
  } finally {
    flushing = false;
  }
}

/**
 * Flush now, and whenever the phone regains a connection.
 *
 * Returns an unsubscribe. Call it once at app start; it is cheap when the vault
 * is empty, which is almost always.
 */
export function initVaultAutoFlush(): () => void {
  let stopped = false;

  const run = () => {
    if (stopped) return;
    // Explicitly not awaited, and explicitly caught. An unhandled rejection from
    // a connectivity callback is the kind that surfaces minutes later attached
    // to nothing.
    void drainNativeVault()
      .then(() => flushVault())
      .catch((err) => console.warn('[vault] auto flush failed', err));
  };

  run();

  let unsubscribe: (() => void) | null = null;
  try {
    unsubscribe = subscribeConnection((state) => {
      if (state.isConnected) run();
    });
  } catch (err) {
    console.warn('[vault] could not subscribe to connectivity', err);
  }

  // The live path: the mesh service failed an upload just now. Held immediately
  // rather than waiting for the next connectivity change, because this phone may
  // already be online and simply have hit a 5xx.
  let nativeSub: { remove: () => void } | null = null;
  try {
    nativeSub = DeviceEventEmitter.addListener(
      'OrbiiMeshUnbridged',
      (e: { msgId?: string; sealed?: string }) => {
        if (stopped || !e?.msgId || !e?.sealed) return;
        console.log(`[vault] caught an unbridged packet ${e.msgId}`);
        void vaultHold(e.msgId, e.sealed)
          .then((held) => {
            if (held) run();
          })
          .catch((err) => console.warn('[vault] could not hold a caught packet', err));
      },
    );
  } catch (err) {
    console.warn('[vault] could not subscribe to mesh events', err);
  }

  return () => {
    stopped = true;
    try {
      unsubscribe?.();
    } catch {
      // ignore
    }
    try {
      nativeSub?.remove();
    } catch {
      // ignore
    }
  };
}
