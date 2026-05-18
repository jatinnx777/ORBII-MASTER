import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { addBreadcrumb, reportError } from '../error-reporting';
import { getItem, storageKeys } from '../storage';
import type {
  StartArgs,
  StartResult,
  WakeWordHandle,
  WakeWordProvider,
} from './provider';

// Built-in keywords Porcupine 3.x ships with. We default to JARVIS —
// recognisable, easy to say one-handed. Custom "ORBII" wake words
// require Picovoice paid plan; tracked as future work in MIGRATION.md.
export const BUILTIN_KEYWORDS = [
  'JARVIS',
  'COMPUTER',
  'AMERICANO',
  'BLUEBERRY',
  'BUMBLEBEE',
  'GRAPEFRUIT',
  'GRASSHOPPER',
  'PICOVOICE',
  'PORCUPINE',
  'TERMINATOR',
] as const;

type NativeOrbiiVoice = {
  start: (accessKey: string, keyword: string | null) => Promise<boolean>;
  stop: () => Promise<boolean>;
  isAvailable: () => Promise<boolean>;
  getBundledKey: () => Promise<string>;
};

const native: NativeOrbiiVoice | null =
  Platform.OS === 'android' &&
  (NativeModules as Record<string, unknown>).OrbiiVoice
    ? ((NativeModules as Record<string, unknown>).OrbiiVoice as NativeOrbiiVoice)
    : null;

async function resolveAccessKey(explicit: string | undefined): Promise<string> {
  // 1. Explicit key wins (advanced testing path).
  if (explicit && explicit.trim()) return explicit.trim();
  // 2. Bundled key from BuildConfig (zero-friction default).
  if (native) {
    try {
      const bundled = await native.getBundledKey();
      if (bundled && bundled.trim()) return bundled.trim();
    } catch (err) {
      addBreadcrumb({
        category: 'voice',
        severity: 'warn',
        message: 'getBundledKey failed',
        data: { err: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  // 3. User-saved key from SecureStore (legacy / advanced).
  const stored = await getItem<string>(storageKeys.voiceAccessKey);
  if (stored && stored.trim()) return stored.trim();
  return '';
}

export const porcupineProvider: WakeWordProvider = {
  id: 'porcupine',
  displayName: 'Picovoice Porcupine',

  isAvailable(): boolean {
    return native != null;
  },

  async start(args: StartArgs): Promise<StartResult> {
    if (!native) {
      return {
        ok: false,
        failure: {
          reason: 'unavailable',
          message: 'Voice service not bundled in this build.',
        },
      };
    }

    const accessKey = await resolveAccessKey(args.accessKey);
    if (!accessKey) {
      return {
        ok: false,
        failure: {
          reason: 'no_key',
          message:
            'No wake-word access key available. Open Voice Setup to add one.',
        },
      };
    }

    const keyword = args.keyword ?? 'JARVIS';

    let sub: { remove: () => void } | null = null;
    try {
      sub = DeviceEventEmitter.addListener(
        'OrbiiVoice:wake',
        (payload: { keyword?: string } | undefined) => {
          addBreadcrumb({
            category: 'voice',
            severity: 'info',
            message: `wake detected: ${payload?.keyword ?? 'unknown'}`,
          });
          args.onWake(payload?.keyword ?? 'unknown');
        },
      );
      await native.start(accessKey, keyword);
      addBreadcrumb({
        category: 'voice',
        severity: 'info',
        message: 'porcupine started',
        data: { keyword },
      });
      const handle: WakeWordHandle = {
        stop: async () => {
          try {
            sub?.remove();
          } catch {
            // ignore
          }
          try {
            await native.stop();
          } catch (err) {
            reportError(err, {
              category: 'voice.stop',
              message: 'failed to stop porcupine',
            });
          }
        },
      };
      return { ok: true, handle };
    } catch (err) {
      try {
        sub?.remove();
      } catch {
        // ignore
      }
      reportError(err, {
        category: 'voice.start',
        message: 'porcupine start failed',
      });
      return {
        ok: false,
        failure: {
          reason: 'engine_error',
          message:
            err instanceof Error ? err.message : 'Voice engine failed to start.',
        },
      };
    }
  },
};
