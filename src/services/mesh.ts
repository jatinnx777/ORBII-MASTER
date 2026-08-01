import { NativeModules, Platform, PermissionsAndroid } from 'react-native';
import { getItem, setItem } from './storage';
import { trackEvent } from './analytics';
import { sealSosForMesh } from './mesh-crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase';

// Offline mesh, Phase 0: read what mesh radios each phone can offer, and report
// it once per install so we learn the real fleet's readiness (how many budget
// Android phones can do BLE long range / Wi-Fi Aware) BEFORE building the mesh.
// Pure capability queries: no scanning, no advertising, no permissions.

export type MeshCapabilities = {
  sdk: number;
  manufacturer: string;
  model: string;
  bleSupported: boolean;
  wifiAwareSupported: boolean;
  leCodedPhySupported: boolean;
  leExtendedAdvertisingSupported: boolean;
  le2MPhySupported: boolean;
  multipleAdvertisementSupported: boolean;
  maxAdvertisingDataLength: number;
  // 'boost_ble_long_range' | 'boost_wifi_aware' | 'floor_ble' | 'none'
  tier: string;
};

const { OrbiiMesh } = NativeModules as {
  OrbiiMesh?: {
    getCapabilities(): Promise<MeshCapabilities>;
    armSosRelay(
      msgId: string,
      ttl: number,
      sealedBase64: string,
      bridgeUrl: string,
      bearer: string,
    ): Promise<boolean>;
    disarm(): Promise<boolean>;
  };
};

const available = Platform.OS === 'android' && !!OrbiiMesh;

// Phase 1 mesh SOS. Origin TTL and the bridge endpoint.
export const MESH_ORIGIN_TTL = 5;

/**
 * Arm the offline mesh with an already-SEALED SOS blob (opaque to native and to
 * every relay). Call this when an SOS fires and there is no internet. The
 * sealing step (crypto_box_seal to the server's public key) happens in JS before
 * this, so relays only ever carry ciphertext.
 */
export async function armMeshSos(
  msgId: string,
  sealedBase64: string,
  bridgeUrl: string,
  bearer: string,
  ttl = MESH_ORIGIN_TTL,
): Promise<boolean> {
  if (!available) return false;
  try {
    return await OrbiiMesh!.armSosRelay(msgId, ttl, sealedBase64, bridgeUrl, bearer);
  } catch {
    return false;
  }
}

export async function disarmMesh(): Promise<void> {
  if (!available) return;
  try {
    await OrbiiMesh!.disarm();
  } catch {
    // ignore
  }
}

const BT_PERMS = [
  'android.permission.BLUETOOTH_ADVERTISE',
  'android.permission.BLUETOOTH_SCAN',
  'android.permission.BLUETOOTH_CONNECT',
];

// CHECK only (no popup). Used at SOS time so we never throw a permission dialog
// in the middle of an emergency. Grant them ahead with requestMeshPermissions.
export async function hasMeshPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android' || !available) return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true;
  try {
    const checks = await Promise.all(BT_PERMS.map((p) => PermissionsAndroid.check(p as never)));
    return checks.every(Boolean);
  } catch {
    return false;
  }
}

// Ask for the Bluetooth permissions ahead of time (Android 12+). Called from a
// one-time setup prompt, never during an SOS.
export async function requestMeshPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android' || !available) return false;
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true;
  try {
    const res = await PermissionsAndroid.requestMultiple(BT_PERMS as never);
    return Object.values(res).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  } catch {
    return false;
  }
}

/**
 * Offline resilience: seal this SOS and relay it over the Bluetooth mesh, so a
 * nearby ORBII phone that has signal can bridge it to the server. Call this when
 * an SOS fires with no internet. Best-effort; never blocks the SOS.
 */
export async function armOfflineSos(
  uid: string,
  lat: number,
  lng: number,
  ts: number,
): Promise<boolean> {
  if (!available) return false;
  try {
    // Check only, never prompt mid-SOS. If not pre-granted, the mesh just does
    // not arm (SMS + queue still cover the offline SOS).
    if (!(await hasMeshPermissions())) return false;
    const { msgId, sealed } = sealSosForMesh({ v: 1, uid, lat, lng, ts });
    const bridgeUrl = `${SUPABASE_URL}/functions/v1/mesh-bridge`;
    return await armMeshSos(msgId, sealed, bridgeUrl, SUPABASE_ANON_KEY);
  } catch {
    return false;
  }
}

export async function getMeshCapabilities(): Promise<MeshCapabilities | null> {
  if (!available) return null;
  try {
    return await OrbiiMesh!.getCapabilities();
  } catch {
    return null;
  }
}

const PROBE_KEY = 'orbii:mesh-probe-reported';

/**
 * Fire the capability report once per install into app_events, so we can query
 * what fraction of real users can do each radio tier. Self-gates so it never
 * spams analytics.
 */
export async function reportMeshCapabilitiesOnce(): Promise<void> {
  if (!available) return;
  try {
    if (await getItem<boolean>(PROBE_KEY)) return;
    const caps = await getMeshCapabilities();
    if (!caps) return;
    trackEvent('mesh_capability_probe', {
      tier: caps.tier,
      codedPhy: caps.leCodedPhySupported,
      extAdv: caps.leExtendedAdvertisingSupported,
      wifiAware: caps.wifiAwareSupported,
      twoMPhy: caps.le2MPhySupported,
      multiAdv: caps.multipleAdvertisementSupported,
      maxAdvLen: caps.maxAdvertisingDataLength,
      sdk: caps.sdk,
      manufacturer: caps.manufacturer,
      model: caps.model,
    });
    await setItem(PROBE_KEY, true);
  } catch {
    // best effort; we'll try again next launch
  }
}
