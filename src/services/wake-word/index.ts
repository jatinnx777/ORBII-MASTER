// Wake-word entry point. The rest of the app imports from here so
// engine swaps stay invisible. To swap to OpenWakeWord later: add
// `openwakeword-provider.ts`, export it from here, and switch the
// `activeProvider` constant. No callsite change needed.
//
// Compatibility shim: the legacy `wake-word.ts` API exposed
// `startBackgroundVoice`, `BUILTIN_KEYWORDS`, and `isVoiceNativeAvailable`.
// We re-export the same names here so existing callers (App.tsx,
// VoiceSetupScreen) keep working without edits.

import type { StartArgs, WakeWordHandle, WakeWordProvider } from './provider';
import { porcupineProvider, BUILTIN_KEYWORDS } from './porcupine-provider';

export { BUILTIN_KEYWORDS };
export type BuiltinKeyword = (typeof BUILTIN_KEYWORDS)[number];

const activeProvider: WakeWordProvider = porcupineProvider;

export function isVoiceNativeAvailable(): boolean {
  return activeProvider.isAvailable();
}

export type StartBackgroundVoiceArgs = {
  accessKey?: string;
  keyword?: BuiltinKeyword;
  onWake: (keyword: string) => void;
};

export async function startBackgroundVoice(
  args: StartBackgroundVoiceArgs,
): Promise<WakeWordHandle | null> {
  const result = await activeProvider.start({
    accessKey: args.accessKey,
    keyword: args.keyword,
    onWake: args.onWake,
  } as StartArgs);
  if (!result.ok) {
    return null;
  }
  return result.handle;
}

// Returns true if the active provider has any way to start (bundled
// key OR user-saved key). The Settings screen uses this to decide
// whether to show "Set up access key" vs hide the row entirely.
//
// Cheap — only reads the bundled key + SecureStore. Does NOT boot
// Porcupine. Avoids spinning up the foreground service just to ask.
import { NativeModules, Platform } from 'react-native';
import { getItem, storageKeys } from '../storage';

export async function canAutoStartVoice(): Promise<boolean> {
  if (!activeProvider.isAvailable()) return false;
  const native = (
    Platform.OS === 'android'
      ? (NativeModules as Record<string, unknown>).OrbiiVoice
      : null
  ) as { getBundledKey?: () => Promise<string> } | null;
  try {
    const bundled = (await native?.getBundledKey?.()) ?? '';
    if (bundled.trim()) return true;
  } catch {
    // ignore
  }
  const stored = (await getItem<string>(storageKeys.voiceAccessKey)) ?? '';
  return stored.trim().length > 0;
}
