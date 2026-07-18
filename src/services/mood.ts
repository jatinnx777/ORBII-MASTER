import { getItem, setItem, storageKeys } from './storage';

// Lightweight wellbeing check-in. Every 12 hours we ask how she's doing. It's
// on-device only (no server, no account needed) — a gentle emotional touch, and
// a private log she could show someone if she ever needed to.

export type Mood = 'happy' | 'calm' | 'sad' | 'anxious' | 'angry';

export type MoodEntry = { mood: Mood; at: number };

const TWELVE_HOURS = 12 * 60 * 60 * 1000;

/** True if it's been at least 12h since we last asked (or never). */
export async function shouldAskMood(): Promise<boolean> {
  const last = (await getItem<number>(storageKeys.moodAskedAt)) ?? 0;
  return Date.now() - last >= TWELVE_HOURS;
}

/** Record the answer (and reset the 12h timer). */
export async function recordMood(mood: Mood): Promise<void> {
  const now = Date.now();
  await setItem(storageKeys.moodAskedAt, now);
  const history = (await getItem<MoodEntry[]>(storageKeys.moodHistory)) ?? [];
  await setItem(storageKeys.moodHistory, [{ mood, at: now }, ...history].slice(0, 60));
}

/** Snooze the prompt for another 12h without recording a mood (she dismissed). */
export async function snoozeMood(): Promise<void> {
  await setItem(storageKeys.moodAskedAt, Date.now());
}

export async function moodHistory(): Promise<MoodEntry[]> {
  return (await getItem<MoodEntry[]>(storageKeys.moodHistory)) ?? [];
}
