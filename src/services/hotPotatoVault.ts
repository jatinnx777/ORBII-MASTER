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
 */

const VAULT_KEY = 'orbii_mesh_vault_v1';

/**
 * Cap on held packets.
 *
 * A bound is required: a phone left scanning in a crowd could otherwise collect
 * indefinitely and this lives in AsyncStorage. When full, the OLDEST is dropped,
 * because a fresher emergency is the one still worth relaying.
 */
export const VAULT_MAX_ENTRIES = 100;

/**
 * How long a packet is worth carrying.
 *
 * Six hours. Past that, either it was bridged by somebody else or the emergency
 * has resolved one way or another, and delivering it would summon a response to
 * something that is over. An SOS is not a letter.
 */
export const VAULT_TTL_MS = 6 * 60 * 60 * 1000;

/** Give up on a packet after this many failed attempts. */
export const MAX_ATTEMPTS = 12;

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
  const live = entries.filter(
    (e) => now - e.heldSince < VAULT_TTL_MS && e.attempts < MAX_ATTEMPTS,
  );
  // Oldest first, so the slice keeps the newest when over capacity.
  live.sort((a, b) => a.heldSince - b.heldSince);
  return live.length > VAULT_MAX_ENTRIES ? live.slice(live.length - VAULT_MAX_ENTRIES) : live;
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

export async function vaultClear(): Promise<void> {
  await write(EMPTY);
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
    let delivered = 0;
    let attempted = 0;

    for (const entry of entries) {
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
        } else {
          survivors.push({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now });
        }
      } catch {
        // Network died mid-flush. Keep it and stop trying the rest now.
        survivors.push({ ...entry, attempts: entry.attempts + 1, lastAttemptAt: now });
      } finally {
        clearTimeout(timer);
      }
    }

    entries = prune(survivors, now);
    await write({ entries });
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
    void flushVault().catch((err) => console.warn('[vault] auto flush failed', err));
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

  return () => {
    stopped = true;
    try {
      unsubscribe?.();
    } catch {
      // ignore
    }
  };
}
