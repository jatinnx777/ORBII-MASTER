import { getItem, setItem, storageKeys } from './storage';
import { addBreadcrumb } from './error-reporting';

/**
 * Survival battery mode.
 *
 * The feature nobody in this category builds, and the one that most obviously
 * saves a life.
 *
 * In a flood with no mains power for three days, battery IS survival. Every hour
 * of phone life is another hour she can be found. Yet turning on "disaster mode"
 * in most apps changes precisely nothing about what the phone is doing, and the
 * app keeps burning charge on things that stopped mattering the moment the water
 * came in.
 *
 * WHAT THIS TURNS OFF, and why each one is safe to lose:
 *
 *   Location history      A breadcrumb trail is for reconstructing a day. In a
 *                         disaster nobody is reconstructing anything, they are
 *                         looking for her right now, and the CURRENT position is
 *                         the only one that matters.
 *   Community and feeds   Nothing being posted is worth a minute of battery.
 *   Presence broadcasts   Being visible as "nearby" is a convenience, not a
 *                         rescue.
 *
 * WHAT IT NEVER TOUCHES, and this is the whole discipline of the file:
 *
 *   Voice SOS             The reason the app exists.
 *   The mesh              In a disaster this is the only working transport, so
 *                         it is the LAST thing to sacrifice, not the first. An
 *                         aggressive power mode that killed the mesh would save
 *                         battery by removing the point of the battery.
 *   SMS and 112           Cost nothing until used.
 *
 * The rule: cut everything that helps someone LOOK BACK, keep everything that
 * helps someone FIND HER.
 */

let active = false;

export function isSurvivalModeOn(): boolean {
  return active;
}

/**
 * Restores across a restart, because a disaster outlasts an app session and the
 * phone will be force-closed and reopened many times over three days.
 */
export async function restoreSurvivalMode(): Promise<boolean> {
  try {
    active = !!(await getItem<boolean>(storageKeys.survivalMode));
  } catch {
    active = false;
  }
  return active;
}

export async function setSurvivalMode(on: boolean): Promise<void> {
  active = on;
  await setItem(storageKeys.survivalMode, on).catch(() => undefined);
  addBreadcrumb({
    category: 'disaster.power',
    message: on ? 'survival battery mode on' : 'survival battery mode off',
    severity: 'info',
  });

}

/**
 * Should this subsystem run right now?
 *
 * Call sites ask rather than being switched off from here, so a new background
 * feature added later has to answer the question deliberately instead of
 * quietly draining a phone that somebody is waiting beside.
 */
export function shouldRun(subsystem: 'history' | 'community' | 'presence' | 'mesh' | 'voice'): boolean {
  if (!active) return true;
  return subsystem === 'mesh' || subsystem === 'voice';
}
