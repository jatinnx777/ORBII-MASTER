import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

// Tiny UI sound layer. Right now it's just a soft "tick" played when the user
// advances an onboarding page, paired with haptics, to make each step feel
// satisfying and keep them moving. Best-effort and fully guarded: audio must
// never crash a screen, so every call swallows its own errors.
//
// The sound file lives at assets/sounds/tick.wav and can be swapped for any
// short clip of your own without touching this code.

let player: AudioPlayer | null = null;

function ensurePlayer(): AudioPlayer | null {
  if (player) return player;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    player = createAudioPlayer(require('../../assets/sounds/tick.wav'));
    player.volume = 0.55;
  } catch {
    player = null;
  }
  return player;
}

/** Play the soft advance "tick". No-op if audio is unavailable. */
export function playTick(): void {
  try {
    const p = ensurePlayer();
    if (!p) return;
    // Rewind first so rapid taps always retrigger the sound.
    void p.seekTo(0);
    p.play();
  } catch {
    // ignore — a UI sound is never worth an error
  }
}
