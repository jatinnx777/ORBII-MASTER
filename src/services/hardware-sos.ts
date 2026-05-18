import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import {
  VolumeManager,
  type VolumeResult,
} from 'react-native-volume-manager';
import { addBreadcrumb } from './error-reporting';

// Hardware-button SOS — three rapid presses of any volume key fire an
// emergency. Two paths run side-by-side:
//
//   1. NATIVE PATH (preferred). A Kotlin AccessibilityService captures
//      key events globally — screen off, app backgrounded or killed,
//      Doze mode, all of it. The user has to enable us once in
//      Settings → Accessibility → ORBII; once they do it survives
//      reboots and OEM kills. This is the path real safety apps use.
//
//   2. JS FALLBACK. react-native-volume-manager listens to volume
//      changes from the JS bridge while the app is foregrounded. Used
//      when (a) the native module is missing, or (b) the user hasn't
//      yet enabled the accessibility service. Limited to the few
//      seconds after the app moves to background; dies once Doze /
//      OEM throttling kicks in.
//
// The host (App.tsx) calls `startHardwareSOS(handler)` once when the
// toggle goes ON. Internally we wire whichever path is available. If
// the user later enables the accessibility service we don't auto-
// switch — they need to toggle off / on or restart the app. Acceptable
// trade-off for this stage.

type SOSHandler = () => void;

type NativeOrbiiHardware = {
  isAccessibilityEnabled: () => Promise<boolean>;
  openAccessibilitySettings: () => Promise<boolean>;
  startListening: () => Promise<boolean>;
  stopListening: () => Promise<boolean>;
};

const native: NativeOrbiiHardware | null =
  Platform.OS === 'android' && (NativeModules as Record<string, unknown>).OrbiiHardware
    ? ((NativeModules as Record<string, unknown>).OrbiiHardware as NativeOrbiiHardware)
    : null;

export function isNativeHardwareAvailable(): boolean {
  return native != null;
}

export async function isAccessibilityEnabled(): Promise<boolean> {
  if (!native) return false;
  try {
    return await native.isAccessibilityEnabled();
  } catch {
    return false;
  }
}

export async function openAccessibilitySettings(): Promise<void> {
  if (!native) return;
  try {
    await native.openAccessibilitySettings();
  } catch (err) {
    addBreadcrumb({
      category: 'hardware-sos',
      severity: 'warn',
      message: 'failed to open accessibility settings',
      data: { err: err instanceof Error ? err.message : String(err) },
    });
  }
}

const TRIPLE_PRESS_WINDOW_MS = 1500;
const COOLDOWN_MS = 8000;
const REQUIRED_PRESSES = 3;

export type StartHardwareResult = {
  stop: () => void;
  source: 'native' | 'js';
};

export async function startHardwareSOS(
  onTrigger: SOSHandler,
): Promise<StartHardwareResult> {
  // Try native first — if the accessibility service is enabled we get
  // global hardware-key capture for free.
  if (native && (await isAccessibilityEnabled())) {
    try {
      await native.startListening();
      const sub = DeviceEventEmitter.addListener(
        'OrbiiHardware:triplePress',
        () => {
          addBreadcrumb({
            category: 'hardware-sos',
            severity: 'info',
            message: 'native triple-press received',
          });
          onTrigger();
        },
      );
      addBreadcrumb({
        category: 'hardware-sos',
        severity: 'info',
        message: 'native listener attached',
      });
      return {
        source: 'native',
        stop: () => {
          sub.remove();
          native.stopListening().catch(() => undefined);
        },
      };
    } catch (err) {
      addBreadcrumb({
        category: 'hardware-sos',
        severity: 'warn',
        message: 'native attach failed, falling back to JS',
        data: { err: err instanceof Error ? err.message : String(err) },
      });
      // fall through to JS path
    }
  }

  return startJsFallback(onTrigger);
}

// ---------------------------------------------------------------------------
// JS fallback (react-native-volume-manager)
// ---------------------------------------------------------------------------

let history: number[] = [];
let lastFiredAt = 0;
let lastVolume: number | null = null;

function recordPressAndMaybeFire(now: number): boolean {
  if (now - lastFiredAt < COOLDOWN_MS) return false;
  history = [...history, now].filter((t) => now - t <= TRIPLE_PRESS_WINDOW_MS);
  if (history.length >= REQUIRED_PRESSES) {
    lastFiredAt = now;
    history = [];
    return true;
  }
  return false;
}

function startJsFallback(onTrigger: SOSHandler): StartHardwareResult {
  history = [];
  lastVolume = null;
  let listener: { remove: () => void } | null = null;

  const onVolumeChange = (result: VolumeResult) => {
    const now = Date.now();
    if (lastVolume === null) {
      lastVolume = result.volume;
      return;
    }
    if (result.volume === lastVolume) return;
    lastVolume = result.volume;
    if (recordPressAndMaybeFire(now)) {
      addBreadcrumb({
        category: 'hardware-sos',
        severity: 'info',
        message: 'JS triple-press detected',
      });
      onTrigger();
    }
  };

  try {
    listener = VolumeManager.addVolumeListener(onVolumeChange);
    addBreadcrumb({
      category: 'hardware-sos',
      severity: 'info',
      message: 'JS volume listener attached',
    });
  } catch (err) {
    addBreadcrumb({
      category: 'hardware-sos',
      severity: 'error',
      message: 'failed to attach JS volume listener',
      data: { err: err instanceof Error ? err.message : String(err) },
    });
  }

  return {
    source: 'js',
    stop: () => {
      try {
        listener?.remove();
      } catch {
        // ignore
      }
      listener = null;
      history = [];
      lastVolume = null;
    },
  };
}
