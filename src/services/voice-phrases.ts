import { getItem, setItem, storageKeys } from './storage';
import { setCustomPhrases } from './voice-detection';

// Custom Voice SOS secret phrases. Users pick their own trigger words
// (e.g. "Call the stars", "Orbii help") on top of the always-on built-in
// panic words ("help", "bachao", "madad"). Phrases are stored locally only
// — they never leave the device — and pushed into the recogniser so it
// both matches and biases toward them.

const MIN_LEN = 3;
const MAX_PHRASES = 5;

export const PHRASE_EXAMPLES = ['Call the stars', 'Orbii help', 'I forgot my keys'];

function normalize(p: string): string {
  return p.trim().replace(/\s+/g, ' ');
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
  setCustomPhrases(cleaned);
  return cleaned;
}

export async function addPhrase(phrase: string): Promise<string[]> {
  const current = await loadPhrases();
  return savePhrases([...current, phrase]);
}

export async function removePhrase(phrase: string): Promise<string[]> {
  const current = await loadPhrases();
  return savePhrases(current.filter((p) => p !== phrase));
}

export const VOICE_PHRASE_LIMITS = { min: MIN_LEN, max: MAX_PHRASES };
