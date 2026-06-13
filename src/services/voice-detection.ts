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
  | 'madad'
  | 'custom';

// User-defined secret phrases (managed by services/voice-phrases.ts). These
// are matched IN ADDITION to the built-in panic words, and fed to the
// recogniser as contextual hints. Stored only on device.
let customPhrasesRaw: string[] = [];
let customPhrasesNorm: string[] = [];

export function setCustomPhrases(phrases: string[]): void {
  customPhrasesRaw = phrases.slice();
  customPhrasesNorm = phrases
    .map((p) => p.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase())
    .filter((p) => p.length >= 3);
}

// Keyword rules. Order matters only for which `keyword` value gets reported;
// the FIRST matching pattern wins. We keep the strict-original patterns at
// the top so we report the canonical keyword, then layer looser fallback
// patterns below to catch shouted/elongated forms and Indian-English STT
// mishears. Each row is independent — adding more patterns can only ADD
// recall, it never removes a previously-matching transcript.
const KEYWORD_RULES: Array<{ keyword: VoiceKeyword; pattern: RegExp }> = [
  // ----- canonical English -----
  { keyword: 'help me', pattern: /\bhelp\s+me\b/i },
  { keyword: 'please help', pattern: /\bplease\s+help\b/i },
  { keyword: 'save me', pattern: /\bsave\s+me\b/i },
  { keyword: 'help', pattern: /\bhelp\b/i },
  // ----- canonical Hindi (existing) -----
  { keyword: 'bachao', pattern: /\bb[ae]?ch+[ao]+\b/i },
  { keyword: 'madad', pattern: /\bmad[ao]+d?t?\b/i },
  // ----- looser fallbacks for shouted / elongated forms -----
  // "heeelp", "hellp", "haaalp" — sustained vowels are common in screams.
  { keyword: 'help', pattern: /\bhe+l+p+\b/i },
  // Common Indian-English STT mishears for "help": "halp", "hep", "alp".
  { keyword: 'help', pattern: /\b(?:halp|hep|elp|alp)\b/i },
  // "help me" with stretched vowels.
  { keyword: 'help me', pattern: /\bhe+l+p+\s+me+\b/i },
  // "help help" — repeated cry, distinct enough to fire even if the single
  // word didn't trigger on its own (sustained panic signal).
  { keyword: 'help', pattern: /\bhelp\s+help\b/i },
  // bachao with stretched vowels: "bachaaaao", "bachaao".
  { keyword: 'bachao', pattern: /\bb[aeu]+c+h+[aeo]+w?\b/i },
  // Pocket STT often turns "bachao" into "back chow" / "bash ow" / "bagaow".
  { keyword: 'bachao', pattern: /\b(?:back\s*chow|bash\s*ow|bagaow|bachow)\b/i },
  // madad mishears: "madat", "mudhad", "mudat", "madhad".
  { keyword: 'madad', pattern: /\bm[au]+d+[ao]*[dt]?h?\b/i },
  // "koi madad", "koi bachao" — common Hindi panic phrases.
  { keyword: 'madad', pattern: /\bkoi\s+ma+d+/i },
  { keyword: 'bachao', pattern: /\bkoi\s+b[ae]+c+h+[ao]+/i },
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
  // User's custom secret phrases — substring match on the normalized form.
  for (const phrase of customPhrasesNorm) {
    if (normalized.includes(phrase)) return 'custom';
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
  // Short delay so the native engine can tear down before we reopen.
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
    // 5 alternatives instead of 3. The engine ranks them by confidence;
    // we scan ALL of them, so more candidates = higher chance the right
    // transcription is somewhere in the list. Pure addition — never hurts.
    maxAlternatives: 5,
    continuous: true,
    requiresOnDeviceRecognition: false,
    addsPunctuation: false,
    // Bias the engine toward our trigger words. Listing common mis-spellings
    // and pocket mishears explicitly raises recall on Indian-accent STT.
    // Adding more strings here can only help — the engine treats them as
    // hints, never as a whitelist.
    contextualStrings: [
      // English canonical + variants
      'help', 'help me', 'save me', 'please help', 'somebody help',
      'help help', 'help me please', 'someone help me', 'help help help',
      'heeelp', 'halp',
      // Hindi canonical + common transliterations
      'bachao', 'bachaao', 'bachao bachao', 'mujhe bachao', 'koi bachao',
      'bacha lo', 'bachaaaao',
      'madad', 'madat', 'madad karo', 'koi madad karo', 'madad chahiye',
      'mujhe madad chahiye',
      // user's own secret phrases (bias the engine toward them)
      ...customPhrasesRaw,
    ],
    // Android: keep the recognizer tolerant of long silences so it doesn't
    // bail between words. Same values that worked before — not touching
    // these because tightening them previously broke recognition.
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
