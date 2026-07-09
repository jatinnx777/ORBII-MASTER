import { getItem, setItem, storageKeys } from './storage';
import { applyPhrases, setCustomPhrases } from './voice-detection';
import { trackEvent } from './analytics';

// Custom Voice SOS secret phrases. Users pick their own trigger words
// (e.g. "Call the stars", "Orbii help") on top of the always-on built-in
// panic words ("help", "bachao", "madad"). Phrases are stored locally only
// — they never leave the device — and pushed into the recogniser so it
// both matches and biases toward them.

const MIN_LEN = 3;
const MAX_PHRASES = 5;

export const PHRASE_EXAMPLES = ['Call the stars', 'I forgot my keys', 'Water the plants'];

function normalize(p: string): string {
  return p.trim().replace(/\s+/g, ' ');
}

// Words so common in ordinary speech that a phrase built only from them would
// fire constantly. (The engine already refuses bare "help" for this reason.)
const TOO_COMMON = new Set([
  'help', 'hello', 'hi', 'hey', 'okay', 'ok', 'yes', 'no', 'stop', 'please',
  'what', 'why', 'now', 'come', 'go', 'the', 'and', 'me', 'you',
]);

// Vosk transcribes ordinary spoken words. It will never reliably emit invented
// names, so "Orbii help" is a phrase that silently NEVER fires — the worst
// possible failure: she thinks she's protected and isn't.
const UNRECOGNISABLE = /[^a-zऀ-ॿ\s]/i;

export type PhraseCheck = { ok: true } | { ok: false; reason: string };

/**
 * Validate a custom phrase BEFORE it's trusted with someone's life.
 * A phrase that can't be heard, or that fires on every conversation, is worse
 * than not setting one at all.
 */
export function validatePhrase(raw: string): PhraseCheck {
  const p = normalize(raw).toLowerCase();
  if (p.length < MIN_LEN) {
    return { ok: false, reason: 'Too short. Use at least a few characters.' };
  }
  if (UNRECOGNISABLE.test(p)) {
    return {
      ok: false,
      reason: 'Use only ordinary words. Numbers and symbols are never heard.',
    };
  }
  const words = p.split(' ').filter(Boolean);
  if (words.length < 2) {
    return {
      ok: false,
      reason: 'Use at least two words — one word triggers by accident.',
    };
  }
  if (words.every((w) => TOO_COMMON.has(w))) {
    return {
      ok: false,
      reason: 'Too common — this would fire during normal conversation.',
    };
  }
  return { ok: true };
}

export async function loadPhrases(): Promise<string[]> {
  const stored = await getItem<string[]>(storageKeys.voicePhrases);
  const phrases = Array.isArray(stored) ? stored : [];
  // Push into the live recogniser on load so detection is ready immediately.
  setCustomPhrases(phrases);
  return phrases;
}

export async function savePhrases(phrases: string[]): Promise<string[]> {
  const cleaned = Array.from(
    new Set(phrases.map(normalize).filter((p) => p.length >= MIN_LEN)),
  ).slice(0, MAX_PHRASES);
  await setItem<string[]>(storageKeys.voicePhrases, cleaned);
  // Push straight into the RUNNING guard, not just the JS cache — otherwise a
  // phrase saved while protection is on silently never fires.
  await applyPhrases(cleaned);
  return cleaned;
}

/** Throws if the phrase would never fire, or would fire constantly. */
export async function addPhrase(phrase: string): Promise<string[]> {
  const check = validatePhrase(phrase);
  if (!check.ok) {
    trackEvent('voice_phrase_rejected', { reason: check.reason });
    throw new Error(check.reason);
  }
  const current = await loadPhrases();
  return savePhrases([...current, phrase]);
}

export async function removePhrase(phrase: string): Promise<string[]> {
  const current = await loadPhrases();
  return savePhrases(current.filter((p) => p !== phrase));
}

export const VOICE_PHRASE_LIMITS = { min: MIN_LEN, max: MAX_PHRASES };
