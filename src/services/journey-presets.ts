import { getItem, setItem, storageKeys } from './storage';

/**
 * Saved Safe Journey presets.
 *
 * A journey somebody takes five nights a week was five taps every time: pick a
 * label, pick a duration, pick a contact, start. The trip does not change, so
 * the setup should not be re-entered. A preset is that same choice, remembered.
 *
 * WHAT A PRESET IS NOT. It cannot start a journey on its own, it cannot change
 * who gets alerted at the moment an SOS fires, and nothing here runs in the
 * background. It is a remembered form, and the worst a bug in this file can do
 * is prefill the start screen wrongly, which the person then sees and corrects
 * before pressing Start.
 *
 * The pure functions are separated from storage on purpose so the rules that
 * matter (dedupe, cap, clamp) are testable without a device.
 */

export type JourneyPreset = {
  id: string;
  /** What the journey is called, e.g. "Hostel to metro". */
  label: string;
  /** How long it usually takes, in minutes. */
  minutes: number;
  /** Who watches this trip. Null means "ask me at the start screen". */
  contactId: string | null;
};

/**
 * Six is enough for the trips a person actually repeats, and few enough that
 * the row stays scannable at a glance rather than becoming a list to search.
 */
export const MAX_PRESETS = 6;

/** Shorter than this and the arrival check fires before she has left. */
export const MIN_MINUTES = 5;

/** Longer than this is not a journey, it is a day, and Safe Journey is wrong for it. */
export const MAX_MINUTES = 12 * 60;

export const MAX_LABEL_LEN = 32;

export function makePresetId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return MIN_MINUTES;
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.round(minutes)));
}

/**
 * Turn anything into a preset we are willing to store, or null if it is not
 * one. A blank label is rejected rather than defaulted, because a preset named
 * nothing is a row she cannot tell apart from the next one.
 */
export function normalisePreset(input: {
  id?: string;
  label: string;
  minutes: number;
  contactId?: string | null;
}): JourneyPreset | null {
  const label = (input.label ?? '').trim().slice(0, MAX_LABEL_LEN);
  if (!label) return null;
  return {
    id: input.id || makePresetId(),
    label,
    minutes: clampMinutes(input.minutes),
    contactId: input.contactId ?? null,
  };
}

/** Two presets are the same trip if they read the same to a human. */
export function samePreset(a: JourneyPreset, b: JourneyPreset): boolean {
  return (
    a.label.trim().toLowerCase() === b.label.trim().toLowerCase() &&
    a.minutes === b.minutes &&
    a.contactId === b.contactId
  );
}

/**
 * Newest first, no duplicates, capped. Saving a trip that is already saved
 * moves it to the front instead of adding a second identical row.
 */
export function addPreset(
  list: JourneyPreset[],
  preset: JourneyPreset,
): JourneyPreset[] {
  const rest = list.filter((p) => p.id !== preset.id && !samePreset(p, preset));
  return [preset, ...rest].slice(0, MAX_PRESETS);
}

export function removePreset(list: JourneyPreset[], id: string): JourneyPreset[] {
  return list.filter((p) => p.id !== id);
}

/**
 * Defensive read of whatever is on disk. Storage survives app upgrades and
 * downgrades, so this assumes nothing about the shape it finds.
 */
export function sanitisePresets(raw: unknown): JourneyPreset[] {
  if (!Array.isArray(raw)) return [];
  const out: JourneyPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<JourneyPreset>;
    if (typeof candidate.label !== 'string') continue;
    if (typeof candidate.minutes !== 'number') continue;
    const preset = normalisePreset({
      id: typeof candidate.id === 'string' ? candidate.id : undefined,
      label: candidate.label,
      minutes: candidate.minutes,
      contactId:
        typeof candidate.contactId === 'string' ? candidate.contactId : null,
    });
    if (preset && !out.some((p) => p.id === preset.id)) out.push(preset);
  }
  return out.slice(0, MAX_PRESETS);
}

export async function loadJourneyPresets(): Promise<JourneyPreset[]> {
  const raw = await getItem<unknown>(storageKeys.journeyPresets);
  return sanitisePresets(raw);
}

export async function saveJourneyPresets(list: JourneyPreset[]): Promise<void> {
  await setItem(storageKeys.journeyPresets, list.slice(0, MAX_PRESETS));
}
