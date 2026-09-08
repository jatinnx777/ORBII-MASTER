/**
 * The pure half of the alert layer: the two lines on an alert card.
 *
 * Split out for the same reason as lib/format: these choose what a person
 * reads at the worst moment of their week, and they could not be tested while
 * they lived beside the Supabase client.
 */

import type { CircleAlert } from '../services/alerts';

/** Minutes since the alert was raised, floored, never negative. */
export function minutesSince(iso: string): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, Math.floor((Date.now() - then) / 60000));
}

/**
 * The sentence at the top of an alert card.
 *
 * Leads with what is MISSING rather than what has happened. "Alert sent" is
 * the fact a person already knows by the time they are reading this screen.
 * "Nobody has accepted" is the fact that decides whether they get up.
 */
export function describeAlert(a: CircleAlert): string {
  const mins = minutesSince(a.created_at);
  const when = mins < 1 ? 'just now' : mins === 1 ? '1 minute ago' : `${mins} minutes ago`;

  if (a.responders === 0 && a.claimed === 0) {
    return `${when}. Nobody has responded yet.`;
  }
  if (a.responders === 0) {
    return `${when}. Someone has taken this on, nobody has arrived.`;
  }
  const n = a.responders;
  return `${when}. ${n} ${n === 1 ? 'person is' : 'people are'} responding.`;
}

/**
 * The headline. What kind of alarm this is, before anything else.
 *
 * A sensor-raised alert and a pressed button are different events and the
 * difference decides the first thirty seconds, which is the only part of this
 * screen that matters.
 */
export function titleFor(a: CircleAlert): string {
  switch (a.trigger) {
    case 'impact':
      return `${a.name} may have had a fall or crash`;
    case 'voice':
      return `${a.name} said the word`;
    case 'geofence':
      return `${a.name} left a safe zone`;
    case 'disaster':
      return `${a.name} raised an alert`;
    default:
      return `${a.name} needs help`;
  }
}

/** The line under the title, when the trigger warrants one. */
export function triggerNote(a: CircleAlert): string | null {
  if (a.trigger === 'impact') {
    return 'Their phone detected a hard impact and they did not respond to the countdown. They may not be able to answer a call.';
  }
  if (a.trigger === 'voice') {
    return 'Raised hands-free, without touching the phone.';
  }
  return null;
}
