import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, storageKeys } from './storage';

// Bridge to the native VoiceGuard foreground service (Android only). The
// service runs on-device Vosk speech recognition and fires an SOS (via the
// orbii://voice-sos deep link) when it hears a secret phrase. No keys, no
// cloud. iOS has no equivalent — background mic isn't permitted by Apple.

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    stopGuard(): Promise<boolean>;
  };
};

export const backgroundVoiceAvailable = Platform.OS === 'android' && !!VoiceGuard;

/** Hours the user can arm background protection for. 0 = until turned off. */
export const PROTECTION_DURATIONS = [
  { label: '4 hours', hours: 4 },
  { label: '12 hours', hours: 12 },
  { label: '24 hours', hours: 24 },
  { label: 'Until I turn it off', hours: 0 },
];

export async function startBackgroundVoice(
  phrases: string[],
  durationHours: number,
): Promise<boolean> {
  if (!VoiceGuard) return false;
  try {
    const durationMs = durationHours > 0 ? durationHours * 3600_000 : 0;
    await VoiceGuard.startGuard(phrases, durationMs);
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundVoice(): Promise<void> {
  if (!VoiceGuard) return;
  try {
    await VoiceGuard.stopGuard();
  } catch {
    // ignore
  }
}

export type BgVoiceState = { enabled: boolean; hours: number };

export async function loadBgVoiceState(): Promise<BgVoiceState> {
  return (await getItem<BgVoiceState>(storageKeys.bgVoice)) ?? { enabled: false, hours: 12 };
}

export async function saveBgVoiceState(state: BgVoiceState): Promise<void> {
  await setItem(storageKeys.bgVoice, state);
}
