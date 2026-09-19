import { NativeModules, Platform } from 'react-native';
import { trackEvent } from './analytics';

/**
 * Shipping the crash detector's shadow log.
 *
 * CrashDetector runs inside the Voice SOS foreground service, which has no
 * network stack and no Supabase client. It records every decision it reaches to
 * SharedPreferences instead, and this drains them into app_events so there is
 * something to read a week later.
 *
 * WHY THIS FILE EXISTS AT ALL. Crash detection ships in shadow mode: it runs
 * against real driving and can fire nothing. That is only worth doing if the
 * recording actually arrives somewhere queryable. A measurement nobody can
 * retrieve is not a measurement, and without this the thresholds in
 * CrashPattern stay guesses forever and the feature can never be armed.
 *
 * Draining is destructive on the native side, so a line is uploaded at most
 * once. If the upload fails the lines are gone, which is the right trade: this
 * is diagnostics, and retrying them is not worth carrying state for.
 */

const { VoiceGuard } = NativeModules as {
  VoiceGuard?: { drainCrashLog?(): Promise<string> };
};

/**
 * Lines per event. The detector can produce a few hundred between foregrounds,
 * and one analytics row carrying all of them is both a large payload and a
 * single point of loss.
 */
export const LINES_PER_BATCH = 25;

/** Split the native blob into clean lines, dropping blanks and whitespace. */
export function parseCrashLog(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/** Chunk lines so no single event carries an unbounded payload. */
export function batchLines(lines: string[], size: number = LINES_PER_BATCH): string[][] {
  if (size < 1) return lines.length ? [lines] : [];
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += size) {
    out.push(lines.slice(i, i + size));
  }
  return out;
}

/**
 * Drain the native log and ship it. Returns how many lines were sent.
 *
 * Never throws. This sits on app foreground and a diagnostics hiccup must not
 * be visible to anyone.
 */
export async function flushCrashLog(): Promise<number> {
  if (Platform.OS !== 'android') return 0;
  const drain = VoiceGuard?.drainCrashLog;
  if (!drain) return 0;
  try {
    const raw = await drain();
    const lines = parseCrashLog(raw);
    if (lines.length === 0) return 0;
    for (const batch of batchLines(lines)) {
      trackEvent('crash_shadow', { lines: batch });
    }
    return lines.length;
  } catch {
    // Older service build without the method, or prefs unreadable. Either way
    // there is nothing useful to do and nothing worth surfacing.
    return 0;
  }
}
