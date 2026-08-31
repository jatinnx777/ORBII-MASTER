import { Accelerometer } from 'expo-sensors';
import { getItem, setItem, storageKeys } from './storage';
import { getVoiceMetrics } from './voice-metrics';

/**
 * How long she gets to say "I am fine" before the SOS goes out.
 *
 * The countdown used to be a flat 5 seconds for everybody, forever. That is the
 * wrong number twice over:
 *
 *   - A phone lying flat on a table hearing "help" out of a TV is the single
 *     most common false trigger there is, and 5 seconds is short for someone in
 *     the next room to notice and reach it.
 *   - A phone that was just thrown, or is being fought over, is about as close
 *     to certain as this app ever gets, and 5 seconds is 5 seconds of nothing
 *     happening.
 *
 * THE SENSOR IS USED BACKWARDS FROM THE OBVIOUS WAY. Every report on this says
 * "fuse the accelerometer into the trigger". Do not. An accelerometer firing an
 * SOS is how false alarms get worse, and volumetricShock.ts is off for exactly
 * that reason. The same sensor pointed the other way REMOVES false alarms: it
 * cannot start anything, it can only decide how long the human gets to answer.
 *
 * Nothing here can trigger an SOS, cancel one, or stop one being sent. The
 * worst thing a bug in this file can do is give somebody the default 5 seconds.
 */

/** What everyone got before this file existed, and still the default. */
export const BASE_SECONDS = 5;

/**
 * Never shorter than this, whatever the sensors say. Below about 3 seconds a
 * person who is holding the phone and looking at it cannot reliably read the
 * screen and press cancel, so a confident classifier would start costing
 * cancellations rather than saving time.
 */
export const FLOOR_SECONDS = 3;

/**
 * Never longer than this. Every extra second is a real delay for someone who
 * cannot reach her phone, and that cost is paid by the people this app exists
 * for. 9 is the most this is willing to spend to keep a false-alarm-prone user
 * from switching Voice SOS off altogether.
 */
export const CEILING_SECONDS = 9;

/** How long the accelerometer is sampled. Runs alongside the countdown. */
export const SAMPLE_MS = 800;
export const SAMPLE_HZ = 20;

/**
 * Standard deviation of acceleration magnitude, in g, below which the phone is
 * not being held by a living person. A hand adds tremor an order of magnitude
 * larger than this even when the person is trying to hold still.
 */
export const STILL_STDEV_G = 0.02;

/** Above this the phone is being moved hard: running, struggling, thrown. */
export const STRUGGLE_STDEV_G = 0.35;

/** A single sample this far from rest is an impact, not a wobble. */
export const STRUGGLE_PEAK_G = 2.5;

/** Voice outcomes remembered per user, oldest dropped. */
export const HISTORY_SIZE = 10;

/** Cancel rate at which a user's window starts getting longer. */
export const CANCEL_PRONE_RATE = 0.5;

/** Below this many outcomes there is not enough history to judge anybody. */
export const MIN_HISTORY = 4;

/**
 * ASR confidence at or above this is a clean recognition, not a near-miss.
 * Vosk reports 0..1.
 */
export const CONF_STRONG = 0.85;

/** Below this the engine half-heard something. Weak evidence, not no evidence. */
export const CONF_WEAK = 0.6;

/**
 * How far above the engine's own speech gate the trigger was, as a ratio.
 *
 * Deliberately a RATIO and not an absolute level. The native service's rms is
 * in whatever units its capture chain produces, and hard-coding a number there
 * would be a guess that breaks on the next phone. vadThreshold is the level
 * that service already calls speech, so rms / vadThreshold means the same thing
 * on every device: 1.0 is ordinary speech, and well above it is a shout.
 */
export const SHOUT_RATIO = 2.5;

/** Metrics older than this are from a different trigger. Ignore them. */
export const SIGNAL_FRESH_MS = 15_000;

export type MotionClass = 'still' | 'ordinary' | 'violent' | 'unknown';

/**
 * What the voice engine heard, as opposed to what the phone felt.
 *
 * Both are null when unavailable, which is the normal case on a build whose
 * native service predates getVoiceMetrics, and the correct answer then is the
 * default window.
 */
export type VoiceSignal = {
  /** 0..1 from the recogniser, or null. */
  confidence: number | null;
  /** rms divided by the engine's speech gate, or null. */
  loudnessRatio: number | null;
};

export type ConfidenceLevel = 'low' | 'normal' | 'high';

export type CountdownPlan = {
  seconds: number;
  level: ConfidenceLevel;
  /** Why, in short slugs. Logged with the outcome so the rules can be judged. */
  reasons: string[];
};

// ---------------------------------------------------------------------------
// PURE PART
// ---------------------------------------------------------------------------

/**
 * Classify a window of acceleration magnitudes, in g.
 *
 * Magnitude, not axes, so it does not matter which way up the phone is.
 * At rest magnitude sits at 1 g and barely moves; what this measures is how
 * much it moves, not what it reads.
 */
export function classifyMotion(samples: number[]): MotionClass {
  // Too few samples to say anything. Saying "unknown" and taking the default is
  // always available and never wrong.
  if (samples.length < 6) return 'unknown';

  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const variance =
    samples.reduce((a, b) => a + (b - mean) * (b - mean), 0) / samples.length;
  const stdev = Math.sqrt(variance);
  const peak = samples.reduce((a, b) => Math.max(a, Math.abs(b - 1)), 0);

  if (stdev >= STRUGGLE_STDEV_G || peak >= STRUGGLE_PEAK_G) return 'violent';
  if (stdev <= STILL_STDEV_G) return 'still';
  return 'ordinary';
}

export type PlanInput = {
  /** Only voice triggers are adjusted. A pressed button is already a decision. */
  source: 'voice' | 'button';
  motion: MotionClass;
  /** Fraction of recent voice triggers this user cancelled, or null if unknown. */
  cancelRate: number | null;
  historySize: number;
  /** What the recogniser heard. Optional: absent means unavailable. */
  voice?: VoiceSignal;
};

/**
 * Decide the window.
 *
 * Two adjustments, and one of them can veto the other:
 *
 *   LONGER, when the trigger looks like a mistake. A phone that is not being
 *   held, or a user who cancels half of what they trigger, gets more time to
 *   catch it. This costs a real victim up to four seconds, which is a genuine
 *   price and the reason for the ceiling. It is worth paying because the
 *   alternative failure is worse: someone whose phone cries wolf turns Voice
 *   SOS off, and then it protects her zero percent of the time.
 *
 *   SHORTER, when the trigger looks real. A phone being fought over while
 *   somebody shouts a trigger word is not ambiguous.
 *
 * Anything that argues for longer forbids shortening outright. When the two
 * signals disagree the app takes the cautious side, because a couple of seconds
 * of delay is recoverable and a false SOS at somebody's address is not.
 *
 * THE VOICE SIGNALS ARE DELIBERATELY ONE-DIRECTIONAL, and this is the most
 * important rule in the file.
 *
 * Every research report recommends treating a quiet or poorly-recognised
 * trigger as weak evidence and making the user wait longer. Following that
 * would be a serious mistake here. A woman hiding in a stairwell whispers. A
 * woman with a hand near her mouth is half-heard. The native service HAS a
 * whisper mode precisely because that is a real and important case, and a rule
 * that punished it would delay exactly the emergencies that are worst.
 *
 * So a shout can shorten the window and a whisper can never lengthen it. Weak
 * recognition does one single thing: it forbids shortening. It withholds
 * confidence rather than asserting doubt.
 */
export function resolveCountdown(input: PlanInput): CountdownPlan {
  const reasons: string[] = [];

  if (input.source !== 'voice') {
    return { seconds: BASE_SECONDS, level: 'normal', reasons: ['button'] };
  }

  let seconds = BASE_SECONDS;
  let mayShorten = true;
  let level: ConfidenceLevel = 'normal';

  const prone =
    input.cancelRate !== null &&
    input.historySize >= MIN_HISTORY &&
    input.cancelRate >= CANCEL_PRONE_RATE;

  if (prone) {
    seconds += 2;
    mayShorten = false;
    level = 'low';
    reasons.push('cancel_prone');
  }

  if (input.motion === 'still') {
    seconds += 2;
    mayShorten = false;
    level = 'low';
    reasons.push('phone_untouched');
  } else if (input.motion === 'unknown') {
    reasons.push('no_motion_data');
  }

  // Corroboration, counted rather than trusted one at a time.
  //
  // Shortening used to happen on violent motion alone. A phone can be shaken
  // hard for a hundred innocent reasons, so on its own that is not enough to
  // take time away from somebody's chance to cancel. Two independent signals
  // agreeing is a different claim, and it is the multi-signal rule the research
  // is actually reaching for.
  let corroboration = 0;
  if (input.motion === 'violent') {
    corroboration += 1;
    reasons.push('violent_motion');
  }
  const conf = input.voice?.confidence ?? null;
  const loud = input.voice?.loudnessRatio ?? null;

  if (conf !== null && conf >= CONF_STRONG) {
    corroboration += 1;
    reasons.push('clear_recognition');
  } else if (conf !== null && conf < CONF_WEAK) {
    // Withholds confidence. Never adds seconds: see the whisper note above.
    mayShorten = false;
    reasons.push('half_heard');
  }

  if (loud !== null && loud >= SHOUT_RATIO) {
    corroboration += 1;
    reasons.push('shouted');
  }

  if (corroboration >= 2 && mayShorten) {
    seconds -= 2;
    level = 'high';
  }

  seconds = Math.max(FLOOR_SECONDS, Math.min(CEILING_SECONDS, seconds));
  return { seconds, level, reasons };
}

// ---------------------------------------------------------------------------
// HISTORY
// ---------------------------------------------------------------------------

type VoiceOutcome = { cancelled: boolean; at: number };

/**
 * Remembered on the device only, never uploaded, and only ever ten booleans.
 * Whether a person is prone to false triggers is about their room, their phone
 * and their voice, so it is answered where those are.
 */
export async function recordVoiceOutcome(cancelled: boolean): Promise<void> {
  try {
    const prev = (await getItem<VoiceOutcome[]>(storageKeys.voiceOutcomes)) ?? [];
    const next = [...prev, { cancelled, at: Date.now() }].slice(-HISTORY_SIZE);
    await setItem(storageKeys.voiceOutcomes, next);
  } catch {
    // A lost outcome costs the default window. Never worth surfacing.
  }
}

export async function loadCancelRate(): Promise<{ rate: number | null; size: number }> {
  try {
    const rows = (await getItem<VoiceOutcome[]>(storageKeys.voiceOutcomes)) ?? [];
    if (rows.length === 0) return { rate: null, size: 0 };
    const cancelled = rows.filter((r) => r.cancelled).length;
    return { rate: cancelled / rows.length, size: rows.length };
  } catch {
    return { rate: null, size: 0 };
  }
}

// ---------------------------------------------------------------------------
// WHAT THE ENGINE HEARD
// ---------------------------------------------------------------------------

/**
 * Read the recogniser's own view of the trigger that just fired.
 *
 * COSTS NOTHING AND NEEDED NO NATIVE CHANGE. VoiceGuard has been computing rms,
 * vadThreshold and lastConfidence all along, and exposing them through
 * getVoiceMetrics for a hidden debug screen. Three numbers that describe how
 * certain the engine was, sitting one bridge call away from the decision they
 * should have been informing.
 *
 * Returns nulls rather than rejecting on: no native module, an older service
 * build, a nonsensical threshold, or metrics left over from an earlier trigger.
 * Every one of those means "no opinion", which resolves to the default window.
 */
export async function readVoiceSignal(): Promise<VoiceSignal> {
  const none: VoiceSignal = { confidence: null, loudnessRatio: null };
  try {
    const m = await getVoiceMetrics();
    if (!m) return none;

    // Stale metrics are worse than none: they describe a DIFFERENT trigger, and
    // acting on them would shorten this countdown because of the last one.
    const age = Date.now() - (m.lastTriggerAtMs ?? 0);
    if (!m.lastTriggerAtMs || age < 0 || age > SIGNAL_FRESH_MS) return none;

    const confidence =
      typeof m.lastConfidence === 'number' && m.lastConfidence > 0 && m.lastConfidence <= 1
        ? m.lastConfidence
        : null;

    const loudnessRatio =
      typeof m.rms === 'number' && typeof m.vadThreshold === 'number' && m.vadThreshold > 0
        ? m.rms / m.vadThreshold
        : null;

    return { confidence, loudnessRatio };
  } catch {
    return none;
  }
}

// ---------------------------------------------------------------------------
// SENSOR
// ---------------------------------------------------------------------------

/**
 * Sample the accelerometer for SAMPLE_MS and classify it.
 *
 * Started when the countdown opens and resolved while it runs, so it costs no
 * delay at all: by the time it answers there are still seconds left to adjust.
 * The sensor is stopped the moment it answers, so unlike a background monitor
 * this has no standing battery cost. It runs for under a second, only when an
 * SOS is already counting down.
 *
 * Never rejects. No sensor, no permission, a device that has no accelerometer
 * at all: every one of those is 'unknown', which means the default window.
 */
export function sampleMotion(ms: number = SAMPLE_MS): Promise<MotionClass> {
  return new Promise((resolve) => {
    let done = false;
    const samples: number[] = [];
    let sub: { remove: () => void } | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      try {
        sub?.remove();
      } catch {
        // best effort
      }
      resolve(classifyMotion(samples));
    };

    try {
      Accelerometer.setUpdateInterval(Math.round(1000 / SAMPLE_HZ));
      sub = Accelerometer.addListener(({ x, y, z }) => {
        samples.push(Math.sqrt(x * x + y * y + z * z));
      });
    } catch {
      finish();
      return;
    }

    setTimeout(finish, ms);
  });
}
