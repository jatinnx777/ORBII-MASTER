// Real Voice SOS self-test.
//
// This arms the exact same on-device VoiceGuard engine that fires a real Voice
// SOS, waits for it to actually hear a panic word ("help help", "bachao", ...),
// and reports success — but routes that detection to a callback instead of
// dispatching an alert. Nothing is sent, nobody is notified, no quota is spent.
//
// The engine signals a hit the only way it can: by firing the
// `orbii://voice-sos` deep link. While a test is running, the deep-link handler
// in App.tsx calls `consumeVoiceTestFire()` first; if it returns true the fire
// belonged to the test and the real SOS flow is skipped.

import { cancelSosAlert, isAvailable, startListening, stopListening } from '@/services/voice-detection';

let active = false;
let onHeard: (() => void) | null = null;
// When a test fire was last consumed. The native service posts a full-screen
// SOS notification AND launches the countdown, so ONE spoken "help" can deliver
// the `orbii://voice-sos` deep link twice (the launch, then the notification's
// auto full-screen or a tap). The first delivery resolves the test; without a
// short grace window the SECOND would slip through and open the REAL emergency
// during a harmless test. This is the fix for "the demo opens the real SOS".
let lastConsumedAt = 0;
const DUPLICATE_GRACE_MS = 8000;

export function isVoiceTestActive(): boolean {
  return active;
}

/**
 * Called by the `orbii://voice-sos` deep-link handler. If a voice test is in
 * progress (or a test just fired moments ago) this consumes the fire and returns
 * true, so the caller must NOT dispatch a real SOS. Returns false otherwise.
 */
export function consumeVoiceTestFire(): boolean {
  const now = Date.now();
  if (active) {
    active = false;
    lastConsumedAt = now;
    const cb = onHeard;
    onHeard = null;
    void stopListening();
    // Kill the SOS notification so a later tap can't re-open the real countdown.
    cancelSosAlert();
    cb?.();
    return true;
  }
  // The same test's second delivery (auto full-screen / notification tap).
  if (now - lastConsumedAt < DUPLICATE_GRACE_MS) {
    cancelSosAlert();
    return true;
  }
  return false;
}

export type VoiceTestResult =
  | 'heard' // engine detected a panic word — the real win
  | 'timeout' // armed fine, but nothing was heard in time
  | 'unavailable' // native engine not present (e.g. non-Android)
  | 'permission' // mic permission denied
  | 'error';

/**
 * Arm the engine and resolve when a panic word is heard, or on timeout. Always
 * stops the engine before resolving (unless always-on background protection is
 * armed, which stopListening() preserves).
 */
export function runVoiceTest(timeoutMs = 20000): Promise<VoiceTestResult> {
  if (!isAvailable()) return Promise.resolve('unavailable');

  return new Promise<VoiceTestResult>((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout>;

    const finish = (r: VoiceTestResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };

    const clearTest = () => {
      active = false;
      onHeard = null;
      void stopListening();
    };

    onHeard = () => finish('heard'); // consumeVoiceTestFire already stopped the engine
    active = true;

    timer = setTimeout(() => {
      clearTest();
      finish('timeout');
    }, timeoutMs);

    startListening()
      .then((res) => {
        if (res.ok) return;
        clearTest();
        finish(
          res.reason === 'permission-denied'
            ? 'permission'
            : res.reason === 'native-unavailable'
              ? 'unavailable'
              : 'error',
        );
      })
      .catch(() => {
        clearTest();
        finish('error');
      });
  });
}

/** Abort a running test (e.g. the user closed the modal) and stop the engine. */
export function cancelVoiceTest(): void {
  if (!active) return;
  active = false;
  onHeard = null;
  void stopListening();
}
