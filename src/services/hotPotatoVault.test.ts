import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NativeModules } from 'react-native';
import { __reset as resetStorage } from '../../test/stubs/async-storage';
import { __setConnected } from '../../test/stubs/netinfo';
import {
  vaultLimits,
  resetVaultLimits,
  MAX_ATTEMPTS,
  vaultHold,
  vaultPeek,
  vaultSize,
  vaultClear,
  flushVault,
} from './hotPotatoVault';

/**
 * The bounds are enforced in Kotlin and in TypeScript, and both must agree.
 * These tests cover the resolution path, not the storage: they prove that JS
 * takes the native numbers when they exist and degrades sensibly when they do
 * not, which is the whole point of moving the source of truth into MeshVault.kt.
 */

const mods = NativeModules as Record<string, unknown>;

describe('vaultLimits', () => {
  beforeEach(() => {
    resetVaultLimits();
    delete mods.OrbiiMesh;
  });

  afterEach(() => {
    resetVaultLimits();
    delete mods.OrbiiMesh;
  });

  it('falls back cleanly with no native module at all', () => {
    // This is the unit-test and iOS case. It must not throw, and it must not
    // silently produce zero, which would expire every packet instantly.
    const limits = vaultLimits();
    expect(limits.fromNative).toBe(false);
    expect(limits.maxEntries).toBe(100);
    expect(limits.ttlMs).toBe(21_600_000);
  });

  it('reads getConstants() when the module exposes it', () => {
    mods.OrbiiMesh = {
      getConstants: () => ({ VAULT_MAX_ENTRIES: 250, VAULT_TTL_MS: 3_600_000 }),
    };
    const limits = vaultLimits();
    expect(limits.fromNative).toBe(true);
    expect(limits.maxEntries).toBe(250);
    expect(limits.ttlMs).toBe(3_600_000);
  });

  it('reads properties directly when constants are merged onto the module', () => {
    // The legacy bridge shape. Which one you get depends on the interop layer,
    // so both have to work.
    mods.OrbiiMesh = { VAULT_MAX_ENTRIES: 42, VAULT_TTL_MS: 7_200_000 };
    const limits = vaultLimits();
    expect(limits.fromNative).toBe(true);
    expect(limits.maxEntries).toBe(42);
    expect(limits.ttlMs).toBe(7_200_000);
  });

  it('survives getConstants() throwing', () => {
    mods.OrbiiMesh = {
      getConstants: () => {
        throw new Error('bridge not ready');
      },
    };
    expect(() => vaultLimits()).not.toThrow();
    expect(vaultLimits().maxEntries).toBe(100);
  });

  it('rejects zero, negative and non-numeric values rather than using them', () => {
    // A zero TTL would expire every held packet the instant it arrived, and the
    // vault would look like it was working while delivering nothing.
    mods.OrbiiMesh = { VAULT_MAX_ENTRIES: 0, VAULT_TTL_MS: -1 };
    const limits = vaultLimits();
    expect(limits.fromNative).toBe(false);
    expect(limits.maxEntries).toBe(100);
    expect(limits.ttlMs).toBe(21_600_000);
  });

  it('ignores a partially populated constants map', () => {
    mods.OrbiiMesh = { VAULT_MAX_ENTRIES: 250 };
    const limits = vaultLimits();
    expect(limits.maxEntries).toBe(250);
    expect(limits.ttlMs).toBe(21_600_000);
    // Not fully native, so a drift warning would be misleading.
    expect(limits.fromNative).toBe(false);
  });

  it('caches, so the bridge is not read on every prune', () => {
    let calls = 0;
    mods.OrbiiMesh = {
      getConstants: () => {
        calls += 1;
        return { VAULT_MAX_ENTRIES: 7, VAULT_TTL_MS: 1000 };
      },
    };
    vaultLimits();
    vaultLimits();
    vaultLimits();
    expect(calls).toBe(1);
  });

  it('does not throw on __DEV__, which does not exist outside Metro', () => {
    // A bare `__DEV__` is a ReferenceError in Node, and TypeScript will not
    // catch it because the RN types declare it globally.
    mods.OrbiiMesh = { VAULT_MAX_ENTRIES: 250, VAULT_TTL_MS: 3_600_000 };
    expect(() => vaultLimits()).not.toThrow();
  });
});

describe('vault constants that stay in JS', () => {
  it('keeps the attempt ceiling local, because only JS retries', () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// flushVault: the two failures that lost other people's emergencies
// ---------------------------------------------------------------------------

type FetchImpl = (url: string, init: { body?: string }) => Promise<{ ok: boolean; status: number }>;

function installFetch(impl: FetchImpl): void {
  (globalThis as unknown as { fetch: unknown }).fetch = impl as unknown;
}

/** msgIds are read back out of the POST body so a test can assert send order. */
function idOf(init: { body?: string }): string {
  return JSON.parse(init.body ?? '{}').msgId as string;
}

describe('flushVault concurrency and network death', () => {
  const realFetch = globalThis.fetch;

  beforeEach(async () => {
    resetStorage();
    resetVaultLimits();
    await vaultClear();
    __setConnected(true);
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = realFetch as unknown;
    __setConnected(false);
  });

  it('preserves a packet held DURING an in-flight flush', async () => {
    // The bug: flushVault snapshotted the vault, spent the network window, then
    // blind-wrote survivors. A vaultHold from the native mesh listener landing
    // in that window was erased with no error and no log.
    await vaultHold('a', 'sealed-a');

    let heldDuringFlush = false;
    installFetch(async () => {
      if (!heldDuringFlush) {
        heldDuringFlush = true;
        // The native OrbiiMeshUnbridged listener fires mid-flush.
        await vaultHold('b', 'sealed-b');
      }
      return { ok: true, status: 200 };
    });

    const res = await flushVault();
    expect(res.delivered).toBe(1);

    const left = await vaultPeek();
    expect(left.map((e) => e.msgId)).toEqual(['b']);
  });

  it('does not resurrect a delivered packet from the re-read', async () => {
    // The merge re-reads storage, which still contains everything the flush
    // started with. Delivered ids must be removed or every flush is a no-op.
    await vaultHold('a', 'sealed-a');
    await vaultHold('b', 'sealed-b');
    installFetch(async () => ({ ok: true, status: 200 }));

    const res = await flushVault();
    expect(res.delivered).toBe(2);
    expect(await vaultSize()).toBe(0);
  });

  it('halts on network death and does not touch packets it never sent', async () => {
    // The bug: the loop continued against a connection already known to be
    // down, charging an attempt to every remaining packet. With flapping wifi,
    // MAX_ATTEMPTS was reached in minutes and prune() deleted them silently.
    for (const id of ['a', 'b', 'c', 'd']) await vaultHold(id, `sealed-${id}`);

    const sent: string[] = [];
    installFetch(async (_url, init) => {
      sent.push(idOf(init));
      throw new Error('network down');
    });

    await flushVault();

    // Exactly one request went out, not four.
    expect(sent).toHaveLength(1);

    const left = await vaultPeek();
    expect(left).toHaveLength(4);

    const byId = Object.fromEntries(left.map((e) => [e.msgId, e.attempts]));
    expect(byId[sent[0]]).toBe(1); // the one actually in flight
    for (const id of ['a', 'b', 'c', 'd']) {
      if (id !== sent[0]) expect(byId[id]).toBe(0); // never sent, never charged
    }
  });

  it('survives repeated network flaps without charging untried packets', async () => {
    // The old loop charged every packet on every flush, so MAX_ATTEMPTS worth of
    // wifi flapping emptied the vault. Now only the head of the queue is tried,
    // and the ones behind it wait untouched.
    await vaultHold('a', 'sealed-a');
    await vaultHold('b', 'sealed-b');
    installFetch(async () => {
      throw new Error('network down');
    });

    const flaps = 5;
    for (let i = 0; i < flaps; i += 1) await flushVault();

    const left = await vaultPeek();
    expect(left).toHaveLength(2);
    const byId = Object.fromEntries(left.map((e) => [e.msgId, e.attempts]));
    expect(byId.a).toBe(flaps); // tried every round, charged every round
    expect(byId.b).toBe(0); // never sent, so never charged
  });

  it('lets a queued packet have its turn once the one ahead retires', async () => {
    // The flip side. Charging only the head must not starve the tail forever:
    // when the head exhausts MAX_ATTEMPTS and is pruned, the next one is tried.
    // Without this the fix would trade silent deletion for a silent stall.
    await vaultHold('a', 'sealed-a');
    await vaultHold('b', 'sealed-b');
    installFetch(async () => {
      throw new Error('network down');
    });

    for (let i = 0; i < MAX_ATTEMPTS + 1; i += 1) await flushVault();

    const left = await vaultPeek();
    expect(left.map((e) => e.msgId)).toEqual(['b']); // 'a' retired, 'b' remains
    expect(left[0].attempts).toBeGreaterThan(0); // and is now being tried
  });

  it('charges an attempt on a 5xx but keeps the packet', async () => {
    await vaultHold('a', 'sealed-a');
    installFetch(async () => ({ ok: false, status: 503 }));

    await flushVault();
    const left = await vaultPeek();
    expect(left).toHaveLength(1);
    expect(left[0].attempts).toBe(1);
  });

  it('treats a 4xx as delivered, because it means the bridge already has it', async () => {
    await vaultHold('a', 'sealed-a');
    installFetch(async () => ({ ok: false, status: 409 }));

    const res = await flushVault();
    expect(res.delivered).toBe(1);
    expect(await vaultSize()).toBe(0);
  });

  it('skips entirely when offline and keeps everything', async () => {
    await vaultHold('a', 'sealed-a');
    __setConnected(false);
    installFetch(async () => {
      throw new Error('should never be called while offline');
    });

    const res = await flushVault();
    expect(res.skippedOffline).toBe(true);
    expect(res.remaining).toBe(1);
    expect((await vaultPeek())[0].attempts).toBe(0);
  });

  it('deduplicates a packet the mesh floods twice', async () => {
    expect(await vaultHold('a', 'sealed-a')).toBe(true);
    expect(await vaultHold('a', 'sealed-a')).toBe(false);
    expect(await vaultSize()).toBe(1);
  });
});
