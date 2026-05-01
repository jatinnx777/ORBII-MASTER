import { Accelerometer } from 'expo-sensors';

// Crash detector.
//
// Reads accelerometer at 50 Hz. When the total magnitude of acceleration
// (|a| = sqrt(x² + y² + z²) on the Expo "g" scale where 1 g ≈ 1.0) crosses
// CRASH_G for at least SUSTAIN_MS, we treat it as a suspected crash and
// fire the listener. Two more guards prevent false positives:
//
//   1. Cooldown — we never fire twice within COOLDOWN_MS, so a single
//      crash can't trigger a stream of alerts.
//   2. Sustain check — we require the threshold to be crossed across
//      multiple samples in a row, not a single spike. Phone drops produce
//      one big sample then bounce; an actual collision smashes for ~50 ms.
//
// The values below are tuned for Indian-context vehicles (cars, autos,
// scooters). 4 g sustained is a hard collision; 3 g is the lower edge of
// "accident" territory, well above normal driving (peaks around 1.2 g
// during hard braking).

const SAMPLE_HZ = 50;
const SAMPLE_INTERVAL_MS = 1000 / SAMPLE_HZ;
const CRASH_G = 3.5;
// Minimum sustained duration above CRASH_G to count as a crash.
const SUSTAIN_MS = 80;
const SUSTAIN_SAMPLES = Math.ceil(SUSTAIN_MS / SAMPLE_INTERVAL_MS);
const COOLDOWN_MS = 30_000;

type CrashListener = (event: {
  magnitude: number;
  at: number;
}) => void;

let active = false;
let lastFiredAt = 0;
let exceedSamples = 0;
let lastPeak = 0;
let listeners: CrashListener[] = [];
let subscription: { remove: () => void } | null = null;

export function subscribeCrashEvents(listener: CrashListener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export async function startCrashDetection(): Promise<{ ok: boolean; reason?: string }> {
  if (active) return { ok: true };
  try {
    const available = await Accelerometer.isAvailableAsync();
    if (!available) return { ok: false, reason: 'sensor-unavailable' };
  } catch {
    return { ok: false, reason: 'sensor-unavailable' };
  }
  try {
    Accelerometer.setUpdateInterval(SAMPLE_INTERVAL_MS);
    subscription = Accelerometer.addListener(({ x, y, z }) => {
      // expo-sensors reports g-units already (1.0 ≈ Earth gravity).
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      if (magnitude >= CRASH_G) {
        exceedSamples += 1;
        if (magnitude > lastPeak) lastPeak = magnitude;
      } else {
        exceedSamples = 0;
        lastPeak = 0;
      }
      if (exceedSamples >= SUSTAIN_SAMPLES) {
        const now = Date.now();
        if (now - lastFiredAt < COOLDOWN_MS) return;
        lastFiredAt = now;
        const peak = lastPeak;
        exceedSamples = 0;
        lastPeak = 0;
        listeners.forEach((l) => {
          try {
            l({ magnitude: peak, at: now });
          } catch (err) {
            console.warn('[crash] listener threw', err);
          }
        });
      }
    });
    active = true;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : 'start-failed',
    };
  }
}

export function stopCrashDetection(): void {
  if (subscription) {
    try {
      subscription.remove();
    } catch {
      // ignore
    }
    subscription = null;
  }
  active = false;
  exceedSamples = 0;
  lastPeak = 0;
}

export function isCrashDetectionActive(): boolean {
  return active;
}
