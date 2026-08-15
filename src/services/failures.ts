import { addBreadcrumb, reportError } from './error-reporting';

// How ORBII is allowed to fail.
//
// The codebase used to write three very different failures identically, a
// `.catch(() => undefined)` on a haptic buzz looked exactly like one on
// "save the user's emergency contact". One is fine; the other is data loss.
// In a release build `console.warn` goes nowhere, so those failures never
// reached `client_errors` and we found out only when users complained.
//
// Every caught failure must now pick one of these three, and the choice is
// visible at the call site:
//
//   ignore()   , genuinely cannot matter (haptics, TTS, opening the dialer).
//   degraded() , a feature got worse; the user is unaffected and shouldn't be
//                 told. Recorded as a breadcrumb so it shows up as context on
//                 the next real error.
//   critical() , a write that must not be lost. Always reported, so it lands
//                 in `client_errors` where we can actually see it.
//
// Nothing here throws: these are catch handlers, and several sit on the SOS
// path where throwing again would be worse than the original failure.

/** The failure genuinely cannot matter. Says so out loud. */
export function ignore(): undefined {
  return undefined;
}

/** A feature degraded. Recorded for context; never surfaced to the user. */
export function degraded(category: string, message: string) {
  return (err: unknown): undefined => {
    addBreadcrumb({
      category,
      severity: 'warn',
      message,
      data: { error: err instanceof Error ? err.message : String(err) },
    });
    return undefined;
  };
}

/**
 * A durable write failed, a contact, a profile, an SOS row, evidence.
 * Always reported so it reaches `client_errors`, because silently losing this
 * is how ORBII breaks its promise to someone.
 */
export function critical(
  category: string,
  message: string,
  tags?: Record<string, string>,
) {
  return (err: unknown): undefined => {
    reportError(err, { category, message, tags });
    return undefined;
  };
}

/**
 * Like `critical`, but the user is doing something and needs to KNOW it failed
 * (saving a contact, accepting a mission, redeeming coins). A silent catch here
 * looks like success and quietly breaks trust. Reports for telemetry AND shows
 * a plain message. Lazy-imports the dialog so this stays usable on the SOS path
 * without pulling UI into every failure site.
 */
export function surfaced(
  category: string,
  userMessage: string,
  title = 'Something went wrong',
) {
  return (err: unknown): undefined => {
    reportError(err, { category, message: userMessage });
    // Lazy require avoids a static UI dependency (and any import cycle) here.
    try {
      const { appAlert } = require('@/components/common/AppDialog') as {
        appAlert: (t: string, m: string) => void;
      };
      appAlert(title, userMessage);
    } catch {
      // If the dialog can't load we've still reported it; never throw from a catch.
    }
    return undefined;
  };
}
