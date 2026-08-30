/**
 * Onboarding clips, one per step, per language.
 *
 * DROP FILES IN AND THEY PLAY. Put an mp4 in `assets/onboarding/` named
 * `<step>-<lang>.mp4`, uncomment its line, done. A step with no clip is not
 * broken; it shows a titled panel, so the flow ships whether or not the filming
 * has happened.
 *
 * The scripts, the delivery notes and the reasons behind them are in
 * ONBOARDING_SCRIPTS.md at the root of this repo. Read that before filming, not
 * after.
 *
 * SIZE. Twelve clips in two languages is roughly 40 to 50 MB. The apk is
 * already ~138 MB because both Vosk speech models ship inside it, and a woman
 * downloading a safety app in a hurry on hostel wifi is exactly who a 190 MB
 * download loses. So the intention is to STREAM these from Supabase Storage and
 * cache after first play, and `remoteVideoFor` exists for that. Bundling is
 * supported for the two or three clips worth guaranteeing offline.
 */

export type StepVideoKey =
  | 'language'
  | 'what'
  | 'signin'
  | 'name'
  | 'contact'
  | 'voice'
  | 'battery'
  | 'circle'
  | 'zones'
  | 'evidence'
  | 'offline'
  | 'done';

export type OnboardingLang = 'en' | 'hi';

// require() needs a literal path, so these cannot be built in a loop.
const BUNDLED: Partial<Record<string, number>> = {
  // 'what-en':     require('../assets/onboarding/what-en.mp4'),
  // 'what-hi':     require('../assets/onboarding/what-hi.mp4'),
  // 'offline-en':  require('../assets/onboarding/offline-en.mp4'),
  // 'offline-hi':  require('../assets/onboarding/offline-hi.mp4'),
};

/** A clip shipped inside the apk, or null. */
export function videoFor(step: StepVideoKey, lang: OnboardingLang): number | null {
  return BUNDLED[`${step}-${lang}`] ?? null;
}

// Public bucket, no auth, cached by the player after first play. Uploading a new
// clip here replaces it for everyone without an app release, which matters
// because these WILL be re-recorded once somebody watches a real person use them.
const CDN = 'https://henbkyjefhzmxqozlczd.supabase.co/storage/v1/object/public/onboarding';

/**
 * Where a clip lives if it is not bundled.
 *
 * Returns a URL whether or not the file exists yet. A 404 is handled the same
 * way as no clip at all: the stage shows its placeholder. That is deliberate, so
 * uploading a file is the only step needed to make one appear.
 */
export function remoteVideoFor(step: StepVideoKey, lang: OnboardingLang): string {
  return `${CDN}/${step}-${lang}.mp4`;
}
