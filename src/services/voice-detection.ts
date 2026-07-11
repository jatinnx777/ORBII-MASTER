// On-device, fully offline Voice SOS keyword spotting.
//
// Powered by the bundled Vosk models (English + Hindi) running inside the
// native VoiceGuard foreground service — NO speech API, NO network, nothing
// downloaded. The in-app "Voice SOS" toggle runs the exact same engine that
// powers always-on background protection; the only difference is that the
// in-app toggle stops when the user turns it off (it isn't armed for hours).
//
// When the engine hears a trigger phrase it opens the SOS flow via the
// `orbii://voice-sos` deep link (handled + quota-gated in App.tsx), which
// works whether the app is foreground, backgrounded, or locked.

import { NativeModules, PermissionsAndroid, Platform } from 'react-native';
import {
  ensureFullScreenIntentAccess,
  loadBgVoiceState,
} from '@/services/background-voice';

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: {
    startGuard(phrases: string[], durationMs: number): Promise<boolean>;
    setWhisperMode(enabled: boolean): Promise<boolean>;
    stopGuard(): Promise<boolean>;
  };
};

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
// word — they just shout "help, help". The native engine's built-in panic
// words ("help help", "save me", "bachao", "madad", plus their near-miss forms
// and cross-shout repeat detection) are always armed, so we start the guard
// with an empty extra-phrase list.
const NO_EXTRA_PHRASES: string[] = [];

export function isListening(): boolean {
  return listening;
}

/**
 * Whisper mode. The silence gate that keeps the battery alive also makes the
 * engine deafest to a whispered plea — exactly the situation where an attacker
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
// Vosk path — but the export remains so call sites don't break.
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
    void ensureFullScreenIntentAccess();
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
  // Don't tear down the engine if always-on background protection is armed —
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
