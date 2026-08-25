import { Platform, Vibration } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * The continuous pulse that runs for the length of an active SOS.
 *
 * WHY A SEPARATE PATTERN FROM EVERY OTHER BUZZ IN THE APP. A phone in a pocket
 * gives you one channel of information and it is rhythm. A message, a call and
 * an emergency must not feel alike, or the one that matters is the one you
 * assume is a message. This is a long-short-long heartbeat, deliberately unlike
 * the single taps expo-haptics gives the rest of the UI.
 *
 * WHY IT KEEPS GOING. She may not be looking at the screen. She may not be able
 * to. The pulse is the only confirmation that the SOS is still live and still
 * broadcasting, and it must stay true for as long as that is true.
 *
 * WHAT THIS IS NOT FOR. It is not an alarm meant to be heard. Volume is the
 * siren's job and the siren is a separate, deliberate choice (sos-audio.ts),
 * because there are nights when being heard is the thing that gets somebody
 * hurt. The pulse also honours the user's alert-vibration setting, which the
 * SOS screen checks before starting it.
 */

/**
 * One cycle, in milliseconds, as [wait, buzz, wait, buzz, ...].
 *
 * Android takes this pattern natively and repeats it in the OS, so the loop
 * costs no JS timers and cannot be starved by a busy bridge.
 */
export const SOS_PULSE_MS: readonly number[] = [
  0,    // start immediately, she gets the first buzz the instant the SOS fires
  600,  // long
  250,
  600,  // long
  250,
  180,  // short
  1400, // rest, so the cycle reads as a heartbeat rather than a drone
];

/** Total cycle length, derived rather than restated, for the iOS loop. */
export const SOS_PULSE_CYCLE_MS = SOS_PULSE_MS.reduce((a, b) => a + b, 0);

type State = {
  running: boolean;
  timer: ReturnType<typeof setInterval> | null;
};

const state: State = { running: false, timer: null };

/**
 * iOS ignores vibration patterns: React Native's Vibration only supports a fixed
 * ~400ms buzz there, and repeating it gives a flat drone with no rhythm. So iOS
 * gets a timer that fires a heavy impact once per cycle. It is a weaker signal
 * than Android's and that is a platform limit, not a choice.
 */
function pulseOnce(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
    () => undefined,
  );
}

/**
 * Start the pulse. Safe to call repeatedly: a second call while running is a
 * no-op rather than a second overlapping loop, because the SOS screen can
 * re-mount (rotation, returning from the map, a re-render on a new responder)
 * and each mount must not stack another vibration on top.
 */
export function startSosHaptics(): void {
  if (state.running) return;
  state.running = true;

  try {
    if (Platform.OS === 'android') {
      // Native repeat. No JS interval, so nothing to starve and nothing to keep
      // alive while the app is backgrounded.
      Vibration.vibrate(SOS_PULSE_MS as number[], true);
      return;
    }
    pulseOnce();
    state.timer = setInterval(pulseOnce, SOS_PULSE_CYCLE_MS);
  } catch (err) {
    // A device with no vibrator, or an OS that refuses. The SOS itself is
    // unaffected; losing the buzz must never take the emergency down with it.
    state.running = false;
    console.warn('[sos-haptics] could not start', err);
  }
}

/**
 * Stop the pulse.
 *
 * SYNCHRONOUS AND UNCONDITIONAL, deliberately. This is called the instant a
 * safety PIN verifies, before the cancellation request goes anywhere near the
 * network. If it were awaited behind that request, a woman who had just proved
 * the phone was hers would stand there holding a buzzing device through a retry
 * on bad signal, which is exactly the moment she needs it to stop.
 *
 * Safe to call when nothing is running.
 */
export function stopSosHaptics(): void {
  state.running = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  try {
    Vibration.cancel();
  } catch {
    // Nothing was running, or the platform has no vibrator. Either is fine.
  }
}

export function isSosHapticsRunning(): boolean {
  return state.running;
}
