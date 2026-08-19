import { NativeModules, Platform } from 'react-native';

// JS bridge for the native "display over other apps" helper SOS overlay
// (Android only). Pops the alert over whatever app the helper is using, with an
// alarm siren and I'll help / I'm busy buttons. See HelperOverlayModule.kt.

const { HelperOverlay } = NativeModules as {
  HelperOverlay?: {
    hasOverlayPermission(): Promise<boolean>;
    requestOverlayPermission(): Promise<boolean>;
    showOverlay(data: { alertId: string; name?: string; distance?: string }): Promise<boolean>;
    dismissOverlay(): Promise<boolean>;
    showEdgeGlow(): Promise<boolean>;
    dismissEdgeGlow(): Promise<boolean>;
  };
};

const available = Platform.OS === 'android' && !!HelperOverlay;

export function overlayAvailable(): boolean {
  return available;
}

/** Is the "display over other apps" permission granted? */
export async function hasOverlayPermission(): Promise<boolean> {
  if (!available) return false;
  try {
    return await HelperOverlay!.hasOverlayPermission();
  } catch {
    return false;
  }
}

/** Send the user to the system screen to grant overlay permission. */
export async function requestOverlayPermission(): Promise<boolean> {
  if (!available) return false;
  try {
    return await HelperOverlay!.requestOverlayPermission();
  } catch {
    return false;
  }
}

/** Pop the helper alert over the current app. No-op without permission. */
export async function showHelperOverlay(data: {
  alertId: string;
  name?: string;
  distance?: string;
}): Promise<boolean> {
  if (!available) return false;
  try {
    return await HelperOverlay!.showOverlay(data);
  } catch {
    return false;
  }
}

/** Tear the overlay down (e.g. the SOS resolved). */
export async function dismissHelperOverlay(): Promise<void> {
  if (!available) return;
  try {
    await HelperOverlay!.dismissOverlay();
  } catch {
    // ignore
  }
}

/** Human distance string for the overlay ("320 m", "1.4 km"). */
export function formatOverlayDistance(meters: number): string | undefined {
  if (meters < 0) return undefined;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Pulse the screen edges red over whatever app the helper is using.
 *
 * Peripheral by design, and taps pass straight through to the app underneath.
 * The card overlay demands a decision; this is for the far more common failure,
 * a helper scrolling something else who never glances at the notification
 * shade. Catching it in the corner of the eye is the whole point.
 */
export async function showEdgeGlow(): Promise<boolean> {
  if (!available || !HelperOverlay!.showEdgeGlow) return false;
  try {
    return await HelperOverlay!.showEdgeGlow();
  } catch {
    return false;
  }
}

export async function dismissEdgeGlow(): Promise<void> {
  if (!available || !HelperOverlay!.dismissEdgeGlow) return;
  try {
    await HelperOverlay!.dismissEdgeGlow();
  } catch {
    /* already gone */
  }
}
