import { Accelerometer } from 'expo-sensors';

// Shake-to-SOS detector. The most reliable hands-free trigger we have
// because — unlike voice — it works while the phone is in your pocket,
// the screen is off, or you're holding it pressed against your body in
// fight-or-flight mode.
//
// Threshold model:
//   • A "spike" is a single 3-axis acceleration magnitude crossing
//     `SHAKE_FORCE` (1.8 g equivalent). Hand tremor / walking sits well
//     below that.
//   • Three spikes within `WINDOW_MS` (1500 ms) trigger an SOS.
//   • After a trigger we lock out for `COOLDOWN_MS` (5 s) so the
//     vibration of the phone fielding the SOS doesn't double-fire.
//
// Tunable from a single place so we can recalibrate cheaply.

type Handle = { stop: () => void };

const SHAKE_FORCE = 1.8;
const WINDOW_MS = 1500;
const REQUIRED_SPIKES = 3;
const COOLDOWN_MS = 5000;
const SAMPLE_RATE_MS = 100;

export async function startShakeDetector(onShake: () => void): Promise<Handle | null> {
  const available = await Accelerometer.isAvailableAsync().catch(() => false);
  if (!available) return null;
  Accelerometer.setUpdateInterval(SAMPLE_RATE_MS);

  const spikes: number[] = [];
  let lockedUntil = 0;

  const sub = Accelerometer.addListener(({ x, y, z }) => {
    const now = Date.now();
    if (now < lockedUntil) return;
    // expo-sensors reports in g-force units already. Stationary phone
    // reads ~1.0 along whichever axis is vertical. We subtract 1 so a
    // resting phone reads ~0; anything above SHAKE_FORCE is intentional.
    const magnitude = Math.sqrt(x * x + y * y + z * z);
    if (Math.abs(magnitude - 1) < SHAKE_FORCE) return;
    // De-duplicate spikes that arrive faster than the accelerometer
    // can have meaningfully moved (same physical jolt). Anything in the
    // last 80 ms is folded into the previous spike.
    if (spikes.length > 0 && now - spikes[spikes.length - 1] < 80) return;
    spikes.push(now);
    // Trim spikes older than the window.
    while (spikes.length > 0 && now - spikes[0] > WINDOW_MS) spikes.shift();
    if (spikes.length >= REQUIRED_SPIKES) {
      lockedUntil = now + COOLDOWN_MS;
      spikes.length = 0;
      try {
        onShake();
      } catch {
        // Caller threw — swallow so the listener stays alive.
      }
    }
  });

  return {
    stop: () => sub.remove(),
  };
}
