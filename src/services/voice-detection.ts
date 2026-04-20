// Always-on keyword spotting using expo-speech-recognition.
// Listens continuously and fires a callback whenever one of the trigger
// phrases is heard (English + Hindi). We match on partial (interim) results
// so we react the moment the word is spoken instead of waiting for a pause.
//
// Requires a dev build — expo-speech-recognition is a native module and will
// NOT work in Expo Go. See app.json for the config plugin + permission strings.

import Constants from 'expo-constants';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';

// The speech recognition module is native — it requires a dev build. In
// Expo Go (or any environment where the native side isn't linked) the
// module's methods throw. We lazy-load so that simply importing this file
// can never crash the JS bundle, and we expose `isAvailable()` so callers
// can degrade gracefully.
type SpeechModule = typeof import('expo-speech-recognition')['ExpoSpeechRecognitionModule'];

const isExpoGo = Constants.appOwnership === 'expo';

let speechModule: SpeechModule | null = null;
let loadError: string | null = null;

function loadModule(): SpeechModule | null {
  if (speechModule) return speechModule;
  if (loadError) return null;
  if (isExpoGo) {
    loadError = 'expo-go';
    return null;
  }
  try {
    // Dynamic require so a missing native side throws here rather than
    // during bundle evaluation.
    const mod = require('expo-speech-recognition');
    speechModule = mod.ExpoSpeechRecognitionModule as SpeechModule;
    return speechModule;
  } catch (err) {
    loadError = err instanceof Error ? err.message : 'unavailable';
    console.warn('[voice] expo-speech-recognition unavailable:', loadError);
    return null;
  }
}

export function isAvailable(): boolean {
  return loadModule() !== null;
}

export type VoiceKeyword =
  | 'help'
  | 'help me'
  | 'please help'
  | 'save me'
  | 'bachao'
  | 'madad';

// Whole-word / phrase patterns so "helpless" or "unhelpful" won't trigger.
// Patterns are intentionally generous — we'd rather false-positive on a
// shouted "help" than miss a real one. We also strip punctuation before
// matching so "help!" still hits.
const KEYWORD_RULES: Array<{ keyword: VoiceKeyword; pattern: RegExp }> = [
  { keyword: 'help me', pattern: /\bhelp\s+me\b/i },
  { keyword: 'please help', pattern: /\bplease\s+help\b/i },
  { keyword: 'save me', pattern: /\bsave\s+me\b/i },
  { keyword: 'help', pattern: /\bhelp\b/i },
  // bachao / bachaao / bacha / bachhao — Hindi STT often mis-spells; cover
  // common transliterations including the "ch" / "chh" variants.
  { keyword: 'bachao', pattern: /\bb[ae]?ch+[ao]+\b/i },
  // madad / madaad / mada / madat — STT sometimes adds a trailing 't'.
  { keyword: 'madad', pattern: /\bmad[ao]+d?t?\b/i },
];

function normalizeForMatch(text: string): string {
  return text.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

export type VoiceDetectionStatus =
  | 'idle'
  | 'requesting-permission'
  | 'starting'
  | 'listening'
  | 'error';

type Listener = (status: VoiceDetectionStatus, detail?: string) => void;
type KeywordListener = (keyword: VoiceKeyword, transcript: string) => void;

type Subscription = { remove: () => void };

let status: VoiceDetectionStatus = 'idle';
let statusListeners: Listener[] = [];
let keywordListeners: KeywordListener[] = [];
let subs: Subscription[] = [];
let shouldBeListening = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
// Debounce duplicate keyword hits — STT engines emit the same partial
// multiple times as the utterance is being finalized.
let lastFiredAt = 0;

const DEBOUNCE_MS = 2500;

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

function matchKeyword(text: string): VoiceKeyword | null {
  const normalized = normalizeForMatch(text);
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(normalized)) return rule.keyword;
  }
  return null;
}

function fireKeyword(keyword: VoiceKeyword, transcript: string) {
  const now = Date.now();
  if (now - lastFiredAt < DEBOUNCE_MS) return;
  lastFiredAt = now;
  keywordListeners.forEach((l) => {
    try {
      l(keyword, transcript);
    } catch (err) {
      console.warn('[voice] keyword listener threw', err);
    }
  });
}

function cleanupSubs() {
  subs.forEach((s) => s.remove());
  subs = [];
}

function scheduleRestart(delayMs = 250) {
  if (restartTimer) clearTimeout(restartTimer);
  if (!shouldBeListening) return;
  // Short delay so the native engine can tear down before we reopen. We
  // keep this tight because the user expects the trigger to work *now*.
  restartTimer = setTimeout(() => {
    if (shouldBeListening) startNativeSession();
  }, delayMs);
}

function startNativeSession() {
  const mod = loadModule();
  if (!mod) {
    setStatus('error', loadError ?? 'unavailable');
    return;
  }

  const options: ExpoSpeechRecognitionOptions = {
    lang: 'en-IN',
    interimResults: true,
    maxAlternatives: 3,
    continuous: true,
    requiresOnDeviceRecognition: false,
    addsPunctuation: false,
    // Hint the engine toward our trigger words so rare terms like "bachao"
    // / "madad" are more likely to be transcribed accurately. Listing
    // common mis-spellings explicitly raises recall on Indian-accent STT.
    contextualStrings: [
      'help', 'help me', 'save me', 'please help', 'somebody help',
      'bachao', 'bachaao', 'bachao bachao', 'mujhe bachao',
      'madad', 'madat', 'madad karo', 'koi madad karo',
    ],
    // Android: keep the recognizer tolerant of long silences so it doesn't
    // bail between words. iOS ignores these but they're harmless.
    androidIntentOptions: {
      EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 5000,
      EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 3000,
      EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 1500,
    },
  };

  try {
    mod.start(options);
    setStatus('starting');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'start failed';
    setStatus('error', msg);
    scheduleRestart(800);
  }
}

function wireEvents() {
  cleanupSubs();
  const mod = loadModule();
  if (!mod) return;

  subs.push(
    mod.addListener('start', () => {
      setStatus('listening');
    }),
  );

  subs.push(
    mod.addListener('result', (event: ExpoSpeechRecognitionResultEvent) => {
      const results = event?.results ?? [];
      // STT engines return ranked alternatives. We scan all of them — the
      // top hit is often a confident-but-wrong English guess for a Hindi
      // word ("better" instead of "bachao"). Lower-ranked alternatives are
      // frequently correct.
      for (const r of results) {
        const transcript = r?.transcript;
        if (!transcript) continue;
        const hit = matchKeyword(transcript);
        if (hit) {
          fireKeyword(hit, transcript);
          return;
        }
      }
    }),
  );

  subs.push(
    mod.addListener('error', (event: ExpoSpeechRecognitionErrorEvent) => {
      // "no-speech" and "aborted" are routine — just restart the session.
      const code = event?.error ?? 'unknown';
      if (code !== 'no-speech' && code !== 'aborted' && code !== 'audio-capture') {
        setStatus('error', code);
      }
      scheduleRestart();
    }),
  );

  subs.push(
    mod.addListener('end', () => {
      if (shouldBeListening) scheduleRestart();
      else setStatus('idle');
    }),
  );
}

export async function startListening(): Promise<{ ok: boolean; reason?: string }> {
  if (shouldBeListening) return { ok: true };
  const mod = loadModule();
  if (!mod) {
    setStatus('error', loadError ?? 'unavailable');
    return {
      ok: false,
      reason: loadError === 'expo-go' ? 'expo-go' : 'native-unavailable',
    };
  }
  setStatus('requesting-permission');
  try {
    const perm = await mod.requestPermissionsAsync();
    if (!perm.granted) {
      setStatus('idle');
      return { ok: false, reason: 'permission-denied' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'permission request failed';
    setStatus('error', msg);
    return { ok: false, reason: msg };
  }

  shouldBeListening = true;
  wireEvents();
  startNativeSession();
  return { ok: true };
}

export function stopListening(): void {
  shouldBeListening = false;
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  const mod = loadModule();
  if (mod) {
    try {
      mod.stop();
    } catch {
      // ignore — engine may already be stopped
    }
  }
  cleanupSubs();
  setStatus('idle');
}

export function getStatus(): VoiceDetectionStatus {
  return status;
}
