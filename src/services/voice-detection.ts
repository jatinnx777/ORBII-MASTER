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
  | 'madad'
  | 'custom';

// User-defined secret phrases (managed by services/voice-phrases.ts). Passed to
// the native engine on top of the always-on built-in panic words. Stored only
// on device; never leave the phone.
let customPhrases: string[] = [];

export function setCustomPhrases(phrases: string[]): void {
  customPhrases = phrases.filter((p) => p.trim().length >= 3);
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
    await VoiceGuard!.startGuard(customPhrases, 0);
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
