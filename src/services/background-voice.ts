import { NativeModules, Platform } from 'react-native';
import { getItem, setItem, removeItem, storageKeys } from './storage';
import { appAlert } from '@/components/common/AppDialog';
import { logVoiceSessionStart, logVoiceSessionEnd } from './voice-sessions';
import {
  scheduleVoiceExpiryReminders,
  cancelVoiceExpiryReminders,
  fireVoiceGuardRecovered,
} from './notifications';


const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    stopGuard(): Promise<boolean>;
    requestDisableBatteryOptimization?(): Promise<boolean>;
    isIgnoringBatteryOptimization?(): Promise<boolean>;
    canUseFullScreenIntent?(): Promise<boolean>;
    requestFullScreenIntentPermission?(): Promise<boolean>;
    setBootRestore?(enabled: boolean): Promise<boolean>;
    getLastHeartbeat?(): Promise<number>;
    openAppSettings?(): Promise<boolean>;
    openAutoStartSettings?(): Promise<boolean>;
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
    // Remember we asked the OS to listen, and until when, so a later foreground
    // check can tell a phone-killed listener apart from a natural expiry.
    const expiresAtMs = durationHours > 0 ? Date.now() + durationHours * 3600_000 : null;
    void setItem(storageKeys.voiceGuardArmed, true);
    void setItem(storageKeys.voiceGuardArmedAt, Date.now());
    if (expiresAtMs) void setItem(storageKeys.voiceGuardExpiresAt, expiresAtMs);
    else void removeItem(storageKeys.voiceGuardExpiresAt);
    // Remind her before a fixed-length session lapses, so protection never
    // ends silently. "Until I turn it off" (0) has no expiry — clear reminders.
    if (expiresAtMs) {
      void scheduleVoiceExpiryReminders(expiresAtMs);
    } else {
      void cancelVoiceExpiryReminders();
    }
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
  // No live session — drop any pending "about to end" reminders and the
  // armed flag, so the kill-watchdog won't try to resurrect a stopped guard.
  void cancelVoiceExpiryReminders();
  void setItem(storageKeys.voiceGuardArmed, false);
  void removeItem(storageKeys.voiceGuardExpiresAt);
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

// ── OEM survival: heartbeat watchdog + one-tap reliability settings ─────────
//
// Over 70% of phones in India (Xiaomi, Realme, Oppo, Vivo, Samsung) aggressively
// kill background services to save battery. A time-boxed listening session can
// be silently stopped, leaving her feeling protected when she isn't. The native
// service stamps a "heartbeat" every ~30s; if it goes stale while we still
// intend to be listening, the OS killed us. We detect that on foreground and
// re-arm, turning a SILENT failure into a visible, self-healing one.

// Heartbeat older than this (while armed) means the listener was killed. The
// beacon fires every 30s, so 4 min is comfortably past any Doze hiccup.
const HEARTBEAT_STALE_MS = 4 * 60_000;

/** Epoch-ms of the service's last liveness beacon (0 = never started). */
export async function getVoiceGuardHeartbeat(): Promise<number> {
  if (!VoiceGuard?.getLastHeartbeat) return 0;
  try {
    return await VoiceGuard.getLastHeartbeat();
  } catch {
    return 0;
  }
}

/** Open ORBII's App info page (per-app battery/background controls live here). */
export async function openAppSettings(): Promise<void> {
  try {
    await VoiceGuard?.openAppSettings?.();
  } catch {
    // ignore
  }
}

/** Open the OEM autostart/auto-launch manager (falls back to App info). */
export async function openAutostartSettings(): Promise<void> {
  try {
    await VoiceGuard?.openAutoStartSettings?.();
  } catch {
    // ignore
  }
}

/**
 * Call on app foreground. If background Voice SOS was armed but the phone killed
 * the listener, re-arm it for the time that was left and tell her (so she can
 * fix the OEM setting). Returns what happened, mostly for tests/telemetry.
 */
export async function recoverVoiceGuardIfKilled(): Promise<
  'recovered' | 'alive' | 'expired' | 'skipped'
> {
  if (!backgroundVoiceAvailable) return 'skipped';
  const armed = await getItem<boolean>(storageKeys.voiceGuardArmed);
  if (!armed) return 'skipped';

  const now = Date.now();
  const expiresAt = await getItem<number>(storageKeys.voiceGuardExpiresAt);
  // A timed window that has simply run out ended NORMALLY — the native service
  // already told her. Clear the flag; this is not a kill.
  if (expiresAt && now >= expiresAt) {
    await setItem(storageKeys.voiceGuardArmed, false);
    await removeItem(storageKeys.voiceGuardExpiresAt);
    return 'expired';
  }

  const hb = await getVoiceGuardHeartbeat();
  const armedAt = (await getItem<number>(storageKeys.voiceGuardArmedAt)) ?? 0;
  // Alive if a recent heartbeat exists. If none was ever written, only treat it
  // as dead once enough time has passed since arming (avoids a false alarm in
  // the first seconds, before the loop stamps its first beat).
  const stale = hb > 0 ? now - hb > HEARTBEAT_STALE_MS : now - armedAt > HEARTBEAT_STALE_MS;
  if (!stale) return 'alive';

  // Killed. Re-arm for the remaining window (0 = "until turned off").
  const remainingHours = expiresAt ? Math.max(0, (expiresAt - now) / 3600_000) : 0;
  const restarted = await startBackgroundVoice([], remainingHours);
  if (restarted) {
    void fireVoiceGuardRecovered();
    return 'recovered';
  }
  return 'skipped';
}
