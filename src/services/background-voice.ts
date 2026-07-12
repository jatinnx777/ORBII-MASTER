import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, storageKeys } from './storage';
import { appAlert } from '@/components/common/AppDialog';
import { logVoiceSessionStart, logVoiceSessionEnd } from './voice-sessions';


const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    stopGuard(): Promise<boolean>;
    requestDisableBatteryOptimization?(): Promise<boolean>;
    isIgnoringBatteryOptimization?(): Promise<boolean>;
    canUseFullScreenIntent?(): Promise<boolean>;
    requestFullScreenIntentPermission?(): Promise<boolean>;
    setBootRestore?(enabled: boolean): Promise<boolean>;
  };
};

// On Android 14+ the OS demotes our SOS full-screen intent (which is what shows
// the countdown screen over the lock screen) unless the user grants the
// "full-screen notifications" special access. Prompt once when they enable any
// Voice SOS, so locked-phone triggers actually surface the screen.
export async function ensureFullScreenIntentAccess(): Promise<void> {
  if (!VoiceGuard?.canUseFullScreenIntent) return;
  try {
    const ok = await VoiceGuard.canUseFullScreenIntent();
    if (ok) return;
    const asked = await getItem<boolean>(storageKeys.fsiAsked);
    if (asked) return;
    await setItem(storageKeys.fsiAsked, true);
    appAlert(
      'Show SOS over your lock screen',
      'Allow ORBII to show the SOS countdown on your lock screen, so Voice SOS works even when your phone is locked.',
      [
        { text: 'Later', style: 'cancel' },
        {
          text: 'Allow',
          onPress: () => {
            VoiceGuard?.requestFullScreenIntentPermission?.().catch(() => undefined);
          },
        },
      ],
    );
  } catch {
    // ignore — best effort
  }
}

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
    void ensureFullScreenIntentAccess();
    // Survive a reboot — BootReceiver re-arms the service if this is set.
    void VoiceGuard.setBootRestore?.(true);
    // Audit log (fire-and-forget). whisper state is read where it's toggled;
    // default false here keeps the call simple and never blocks arming.
    void logVoiceSessionStart(durationHours, false);
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundVoice(): Promise<void> {
  if (!VoiceGuard) return;
  // Don't resurrect it after a reboot once the user has turned it off.
  void VoiceGuard.setBootRestore?.(false);
  // Close the audit-log row for this session (manual turn-off).
  void logVoiceSessionEnd('manual');
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
