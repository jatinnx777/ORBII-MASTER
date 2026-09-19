// On-device, fully offline Voice SOS keyword spotting.
//
// Powered by the bundled Vosk models (English + Hindi) running inside the
// native VoiceGuard foreground service, NO speech API, NO network, nothing
// downloaded. The in-app "Voice SOS" toggle runs the exact same engine that
// powers always-on background protection; the only difference is that the
// in-app toggle stops when the user turns it off (it isn't armed for hours).
//
// When the engine hears a trigger phrase it opens the SOS flow via the
// `orbii://voice-sos` deep link (handled + quota-gated in App.tsx), which
// works whether the app is foreground, backgrounded, or locked.

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  ensureVoiceSosVisibility,
  loadBgVoiceState,
  saveBgVoiceState,
  startBackgroundVoice,
  stopBackgroundVoice,
  requestBatteryExemption,
} from '@/services/background-voice';

// Voice SOS is ALWAYS time-bounded now, never "until I turn it off". Every
// entry point (Home, Safety tab, Settings, onboarding) arms it for a duration
// the user picks, capped here so the mic can never run indefinitely.
export const VOICE_MAX_HOURS = 8;
export const VOICE_MIN_HOURS = 0.5;

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    setWhisperMode(enabled: boolean): Promise<boolean>;
    setScreamTrigger?(enabled: boolean): Promise<boolean>;
    setShakeTrigger?(enabled: boolean): Promise<boolean>;
    /** The crash switch. See CrashDetector.kt. */
    setCrashTrigger?(enabled: boolean): Promise<boolean>;
    /**
     * Read back and clear the crash shadow log. The detector runs inside a
     * foreground service with no network of its own, so it records decisions to
     * SharedPreferences and this hands them over exactly once.
     */
    drainCrashLog?(): Promise<string>;
    stopGuard(): Promise<boolean>;
    cancelSosAlert?(): Promise<boolean>;
  };
};

/** Dismiss the lingering SOS alert notification (used by the voice self-test). */
export function cancelSosAlert(): void {
  try {
    void VoiceGuard?.cancelSosAlert?.();
  } catch {
    // best effort
  }
}

const available = Platform.OS === 'android' && !!VoiceGuard;

export function isAvailable(): boolean {
  return available;
}

export type VoiceKeyword =
  | 'help'
  | 'help me'
  | 'please help'
  | 'save me'
  | 'bachao'
  | 'madad';

// No custom phrases. In a real emergency nobody remembers an invented secret
// word, they just shout "help, help". The native engine's built-in panic
// words ("help help", "save me", "bachao", "madad", plus their near-miss forms
// and cross-shout repeat detection) are always armed, so we start the guard
// with an empty extra-phrase list.
const NO_EXTRA_PHRASES: string[] = [];

export function isListening(): boolean {
  return listening;
}

/**
 * Whisper mode. The silence gate that keeps the battery alive also makes the
 * engine deafest to a whispered plea, exactly the situation where an attacker
 * is standing next to her. Opt-in; costs battery. Re-issues startGuard so it
 * applies to the already-running service.
 */
export async function setWhisperMode(enabled: boolean): Promise<void> {
  if (!available) return;
  try {
    await VoiceGuard!.setWhisperMode(enabled);
    if (listening) await VoiceGuard!.startGuard(NO_EXTRA_PHRASES, 0);
  } catch {
    // takes effect on the next start
  }
}

/**
 * Scream starts an SOS. Off by default: the on-device sound model hears
 * screams in television and playgrounds, so without this a scream only
 * corroborates a spoken word. The service reads the switch live when a scream
 * is heard, so there is no restart.
 */
export async function setScreamTrigger(enabled: boolean): Promise<void> {
  if (!available || !VoiceGuard!.setScreamTrigger) return;
  try {
    await VoiceGuard!.setScreamTrigger(enabled);
  } catch {
    // stays at its previous value; the Settings copy is re-read on next open
  }
}

/**
 * The deliberate shake for a silent SOS. The service watches this switch and
 * starts or stops its fast accelerometer to match, so the sensor only runs
 * while it is on, and only while Voice SOS itself is running.
 */
export async function setShakeTrigger(enabled: boolean): Promise<void> {
  if (!available || !VoiceGuard!.setShakeTrigger) return;
  try {
    await VoiceGuard!.setShakeTrigger(enabled);
  } catch {
    // stays at its previous value
  }
}

/**
 * A crash opens the SOS countdown.
 *
 * On by default, because the person this is for is driving or riding pillion
 * and is not going to find a switch first. The detector is speed-gated, so
 * with this on and the phone sitting still nothing is running: the
 * accelerometer only arms once GPS says she is moving at vehicle speed.
 *
 * Off is honoured immediately. The service watches the switch and stops the
 * detector outright, rather than leaving it running and discarding matches.
 */
export async function setCrashTrigger(enabled: boolean): Promise<void> {
  if (!available || !VoiceGuard!.setCrashTrigger) return;
  try {
    await VoiceGuard!.setCrashTrigger(enabled);
  } catch {
    // stays at its previous value
  }
}

export type VoiceDetectionStatus =
  | 'idle'
  | 'requesting-permission'
  | 'starting'
  | 'listening'
  | 'error';

type Listener = (status: VoiceDetectionStatus, detail?: string) => void;
type KeywordListener = (keyword: VoiceKeyword, transcript: string) => void;

let status: VoiceDetectionStatus = 'idle';
let statusListeners: Listener[] = [];
// Kept for API compatibility. The native engine fires SOS directly via the
// `orbii://voice-sos` deep link, so these listeners are not invoked on the
// Vosk path, but the export remains so call sites don't break.
let keywordListeners: KeywordListener[] = [];
let listening = false;

export function subscribeStatus(cb: Listener): () => void {
  statusListeners.push(cb);
  cb(status);
  return () => {
    statusListeners = statusListeners.filter((l) => l !== cb);
  };
}

export function subscribeKeyword(cb: KeywordListener): () => void {
  keywordListeners.push(cb);
  return () => {
    keywordListeners = keywordListeners.filter((l) => l !== cb);
  };
}

function setStatus(next: VoiceDetectionStatus, detail?: string) {
  status = next;
  statusListeners.forEach((l) => {
    try {
      l(next, detail);
    } catch (err) {
      console.warn('[voice] status listener threw', err);
    }
  });
}

async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export async function startListening(): Promise<{ ok: boolean; reason?: string }> {
  if (!available) return { ok: false, reason: 'native-unavailable' };
  if (listening) return { ok: true };

  setStatus('requesting-permission');
  const granted = await ensureMicPermission();
  if (!granted) {
    setStatus('idle');
    return { ok: false, reason: 'permission-denied' };
  }

  setStatus('starting');
  try {
    // duration 0 = listen until explicitly stopped.
    await VoiceGuard!.startGuard(NO_EXTRA_PHRASES, 0);
    void ensureVoiceSosVisibility();
    listening = true;
    setStatus('listening');
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'start failed';
    setStatus('error', msg);
    return { ok: false, reason: msg };
  }
}

export async function stopListening(): Promise<void> {
  listening = false;
  // Don't tear down the engine if always-on background protection is armed , 
  // that's a separate, persistent session owned by the user's premium setting.
  try {
    const bg = await loadBgVoiceState();
    if (bg.enabled) {
      setStatus('idle');
      return;
    }
  } catch {
    // fall through and stop
  }
  try {
    await VoiceGuard?.stopGuard();
  } catch {
    // engine may already be stopped
  }
  setStatus('idle');
}

export function getStatus(): VoiceDetectionStatus {
  return status;
}

// Reflect the guard's real on/off in the shared status without starting or
// stopping native twice (arm/disarm own the native calls).
function markGuardState(on: boolean): void {
  listening = on;
  setStatus(on ? 'listening' : 'idle');
}

/**
 * The ONE way to turn Voice SOS on. Always time-bounded (clamped to 8h), starts
 * the background guard with that duration so it auto-stops and fires the
 * expiry warnings, persists the state, and asks the OS not to kill it.
 */
export async function armVoiceSos(hours: number): Promise<{ ok: boolean; reason?: string }> {
  if (!available) return { ok: false, reason: 'native-unavailable' };
  setStatus('requesting-permission');
  const granted = await ensureMicPermission();
  if (!granted) {
    setStatus('idle');
    return { ok: false, reason: 'permission-denied' };
  }
  const h = Math.min(VOICE_MAX_HOURS, Math.max(VOICE_MIN_HOURS, hours));
  setStatus('starting');
  const started = await startBackgroundVoice([], h);
  if (!started) {
    setStatus('error');
    return { ok: false, reason: 'start-failed' };
  }
  await saveBgVoiceState({ enabled: true, hours: h });
  void ensureVoiceSosVisibility();
  void requestBatteryExemption();
  markGuardState(true);
  return { ok: true };
}

/**
 * Put the shared status back in step with the guard after a cold start.
 *
 * armVoiceSos persists {enabled, hours} and App.tsx restarts the background
 * guard from it on launch, but nothing marked the in-memory state. isListening()
 * therefore returned false while the guard was genuinely running: the tile read
 * OFF, and tapping it opened the duration picker instead of offering to turn it
 * off. Voice SOS could be armed with no way to reach disarm.
 *
 * Returns whether the guard is armed, so a caller can render immediately rather
 * than waiting for a status event that only fires on a change.
 */
export async function restoreVoiceState(): Promise<boolean> {
  try {
    const bg = await loadBgVoiceState();
    if (!bg.enabled) {
      markGuardState(false);
      return false;
    }
    await startBackgroundVoice([], bg.hours);
    markGuardState(true);
    return true;
  } catch {
    // A restore that fails must not leave the UI claiming protection it does
    // not have. Off is the safe thing to show.
    markGuardState(false);
    return false;
  }
}

/** The ONE way to turn Voice SOS off. Fully tears the guard down. */
export async function disarmVoiceSos(): Promise<void> {
  await stopBackgroundVoice();
  await saveBgVoiceState({ enabled: false, hours: 0 });
  await stopListening();
  markGuardState(false);
}
