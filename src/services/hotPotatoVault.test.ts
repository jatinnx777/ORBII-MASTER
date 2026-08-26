import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NativeModules } from 'react-native';
import { vaultLimits, resetVaultLimits, MAX_ATTEMPTS } from './hotPotatoVault';

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
