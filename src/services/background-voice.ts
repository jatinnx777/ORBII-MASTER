import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, storageKeys } from './storage';


const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    stopGuard(): Promise<boolean>;
    requestDisableBatteryOptimization?(): Promise<boolean>;
    isIgnoringBatteryOptimization?(): Promise<boolean>;
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

/** True if ORBII is already exempt from battery optimization (Doze). */
export async function isBatteryExempt(): Promise<boolean> {
  if (!VoiceGuard?.isIgnoringBatteryOptimization) return true;
  try {
    return await VoiceGuard.isIgnoringBatteryOptimization();
  } catch {
    return false;
  }
}

/** Prompt the system "let ORBII run in the background?" dialog. */
export async function requestBatteryExemption(): Promise<void> {
  if (!VoiceGuard?.requestDisableBatteryOptimization) return;
  try {
    await VoiceGuard.requestDisableBatteryOptimization();
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
