import { NativeModules, Platform } from 'react-native';
import { getItem, setItem } from './storage';
import { trackEvent } from './analytics';

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
