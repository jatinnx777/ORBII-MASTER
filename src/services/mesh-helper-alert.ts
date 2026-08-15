import { NativeModules, NativeEventEmitter, Platform, EmitterSubscription } from 'react-native';
import * as Crypto from 'expo-crypto';
import { hasMeshPermissions } from './mesh';

/**
 * Offline helper alert, Phase 1, FIRST CUT (needs on-device testing).
 *
 * When an SOS fires with NO internet and no phone nearby can bridge it, the only
 * people who can reach her are ORBII users already within Bluetooth range. This
 * broadcasts a tiny "someone right near me needs help" ping that carries NO
 * location at all, only a random alert id. Nearby helper phones catch it and
 * stream its signal strength, so a helper can walk warmer/colder toward her.
 *
 * Safety: because it carries no coordinates, a hostile phone in range learns
 * only "someone nearby needs help", which it already knew by being nearby. The
 * exact location never leaves her phone. See OFFLINE_HELPER_ALERT_SPEC.md.
 */

export type HelperPing = { alertId: string; rssi: number; at: number };

const { OrbiiMesh } = NativeModules as {
  OrbiiMesh?: {
    armHelperPing(alertId: string, ttl: number): Promise<boolean>;
    stopHelperPing(): Promise<boolean>;
  };
};

const available = Platform.OS === 'android' && !!OrbiiMesh;

// Single hop by design: proximity homing only makes sense within direct radio
// range, so we don't flood the ping across the mesh.
const HELPER_PING_TTL = 1;

function randomAlertId(): string {
  const b = Crypto.getRandomBytes(4);
  let id = '';
  for (let i = 0; i < 4; i++) id += b[i].toString(16).padStart(2, '0');
  return id;
}

/**
 * Victim side: start broadcasting a location-free helper ping. Returns the
 * alertId (so it can be shown / correlated) or null if it couldn't start.
 * Permission is CHECK-only so this never throws a dialog mid-SOS.
 */
export async function armHelperPing(): Promise<string | null> {
  if (!available) return null;
  try {
    if (!(await hasMeshPermissions())) return null;
    const alertId = randomAlertId();
    const ok = await OrbiiMesh!.armHelperPing(alertId, HELPER_PING_TTL);
    return ok ? alertId : null;
  } catch {
    return null;
  }
}

export async function stopHelperPing(): Promise<void> {
  if (!available) return;
  try {
    await OrbiiMesh!.stopHelperPing();
  } catch {
    // ignore
  }
}

/** Helper side: subscribe to caught helper pings (with live signal strength). */
export function subscribeHelperPings(cb: (p: HelperPing) => void): () => void {
  if (!available) return () => {};
  let sub: EmitterSubscription | null = null;
  try {
    const emitter = new NativeEventEmitter(NativeModules.OrbiiMesh);
    sub = emitter.addListener('OrbiiHelperPing', (e: HelperPing) => {
      if (e && typeof e.alertId === 'string') cb(e);
    });
  } catch {
    sub = null;
  }
  return () => {
    try {
      sub?.remove();
    } catch {
      // ignore
    }
  };
}

// Map a raw RSSI (dBm) to a 0..1 "closeness". Very rough and noisy; good enough
// for warmer/colder, never for a real distance. ~-45 = almost touching, ~-95 = edge of range.
export function rssiToCloseness(rssi: number): number {
  const near = -45;
  const far = -95;
  const c = (rssi - far) / (near - far);
  return Math.max(0, Math.min(1, c));
}

export function closenessLabel(c: number): string {
  if (c >= 0.85) return 'Right next to you';
  if (c >= 0.6) return 'Very close';
  if (c >= 0.35) return 'Getting warmer';
  if (c >= 0.15) return 'Nearby, keep looking';
  return 'Faint, move around';
}

export const helperAlertAvailable = available;
