/**
 * One entry point for getting an SOS out, whatever the network is doing.
 *
 * Callers say "send this" and get back a truthful account of what happened. They
 * do not branch on connectivity, and they must not: every place that decides for
 * itself whether the network is up is another place that can decide wrong while
 * somebody is in trouble.
 *
 * THE ORDERING RULE. Online transport is tried first and offline is the
 * fallback, never the reverse and never both eagerly. An SMS is a message to
 * three people; the online path reaches her circle, the helper network and the
 * escalation ladder. Firing SMS first would spend her one guaranteed channel on
 * the smallest audience.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not decide the SOS happened, write
 * to the database, or own retries. sos.ts createSOS and sos-queue.ts already do
 * those and do them correctly. This is transport selection, nothing else.
 */

import { getConnection } from './net';
import { resolveOfflineLocation, describeOfflineLocation } from './offlineGeo';
import {
  dispatchOfflineSMSFallback,
  type SOSPayloadObject,
  type SmsDispatchResult,
} from './offlineSms';

/**
 * How long the online path gets before we stop waiting.
 *
 * Three seconds is a compromise, not a magic number. Long enough that a slow but
 * working 2G handshake is not abandoned; short enough that a person who has just
 * pressed the button is not staring at nothing. If this moves, move it because a
 * measurement said so.
 */
export const ONLINE_ATTEMPT_TIMEOUT_MS = 3000;

/**
 * How long the fallback waits to see whether the timed-out online attempt
 * landed after all, before reporting a route.
 *
 * Bounded and small. This buys an accurate message, not a delivery.
 */
export const LATE_GRACE_MS = 500;

export type TransportRoute =
  | 'online'
  /**
   * The online attempt lost the 3 s race, we fell back, and then it landed
   * inside the grace window. A distinct route rather than 'sms', because
   * telemetry that records this as an SMS delivery is recording something that
   * did not happen.
   */
  | 'online_late'
  | 'sms'
  | 'none';

export type TransportResult = {
  route: TransportRoute;
  /** True if SOMETHING carried the alarm, or is one tap from carrying it. */
  delivered: boolean;
  /**
   * True when a human still has to act, which on Android is the normal SMS
   * outcome. A caller that ignores this will tell her help is coming when a
   * composer is sitting on screen waiting for a tap.
   */
  requiresUserAction: boolean;
  /** The place name we resolved, online or off. Always safe to display. */
  locationName: string;
  /** Why the online path was not used, when it was not. */
  onlineFailureReason: string | null;
  /**
   * The online dispatch timed out, we fell back to SMS, and then it landed
   * anyway. The alarm went out twice.
   *
   * Reported rather than hidden: without it, `route` says 'sms' when the online
   * path actually delivered, so telemetry and the on-screen sentence both
   * describe something that did not happen. A best-effort snapshot, read when
   * the result is built; a completion after that point cannot be seen from here.
   */
  lateOnlineSuccess?: boolean;
  sms?: SmsDispatchResult;
};

export type TransportRequest = {
  payload: SOSPayloadObject;
  emergencyContacts: string[];
  senderName: string;
  /**
   * The real send. Whatever createSOS/broadcast work this SOS needs. Must
   * resolve when the alarm is genuinely away, and reject or hang if it is not.
   *
   * Returning early on optimistic local state would defeat the whole file: we
   * would report online success and never fall back to SMS.
   */
  transmitOnline: () => Promise<void>;
  /**
   * Optional online place lookup (reverse geocode). Raced under the same
   * deadline; failure just means we use the offline name.
   */
  resolveOnlineLocation?: () => Promise<string | null>;
};

/**
 * Reject after ms, without leaving a timer running.
 *
 * The clearTimeout in the finally matters more than it looks: an SOS screen can
 * mount and unmount several times, and a stray 3-second timer per attempt is a
 * slow leak on the one screen that must not degrade.
 */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

/**
 * Resolve the place, offline first.
 *
 * Offline always runs: it is synchronous, free, and gives us a name to fall back
 * to before any network call is attempted. The online lookup can only IMPROVE on
 * it, and only when the offline resolver was not already certain, because a
 * surveyed campus polygon knows "Hostel 3, Block A" and a reverse geocoder will
 * answer with a road name half a kilometre away.
 */
async function resolvePlace(
  lat: number,
  lng: number,
  online: boolean,
  resolveOnlineLocation?: () => Promise<string | null>,
): Promise<string> {
  const offline = resolveOfflineLocation(lat, lng);
  const offlineName = describeOfflineLocation(offline, lat, lng);

  if (!online || !resolveOnlineLocation || offline.basis === 'inside_surveyed') {
    return offlineName;
  }

  try {
    const name = await withTimeout(
      resolveOnlineLocation(),
      ONLINE_ATTEMPT_TIMEOUT_MS,
      'reverse geocode',
    );
    return name && name.trim() ? name.trim() : offlineName;
  } catch {
    return offlineName;
  }
}

/**
 * Send it. Never throws, never leaves a promise unhandled.
 *
 * Every await is inside a try. A rejection escaping this function would surface
 * as an unhandled rejection in the middle of an emergency and, on Android, can
 * take the JS context down with it.
 */
export async function dispatchSOS(req: TransportRequest): Promise<TransportResult> {
  const { lat, lng } = req.payload;

  let online = false;
  try {
    // NetInfo.fetch is async and does not touch the UI thread. It is raced
    // anyway: on some networks the reachability probe itself can hang, and a
    // connectivity CHECK must never outlast the send it was meant to inform.
    const conn = await withTimeout(getConnection(), ONLINE_ATTEMPT_TIMEOUT_MS, 'connectivity check');
    online = conn.isConnected;
  } catch {
    // Unknown connectivity is treated as offline. The costs are not symmetric:
    // assuming online and being wrong means the alarm goes nowhere, assuming
    // offline and being wrong means one extra SMS.
    online = false;
  }

  const locationName = await resolvePlace(lat, lng, online, req.resolveOnlineLocation);

  let onlineFailureReason: string | null = online ? null : 'no usable network connection';

  // Deliberately NOT cancelled when the race is lost. A slow but working link
  // that completes at four seconds DID send the alarm, and pretending otherwise
  // would make the result a lie in the safer-sounding direction.
  let lateOnlineSuccess = false;

  // Kept so the fallback path can give it a brief chance to land.
  let attempt: Promise<void> | null = null;

  if (online) {
    try {
      // INSIDE the try. transmitOnline is caller-supplied and may throw
      // synchronously rather than returning a rejected promise; called outside,
      // that exception escapes dispatchSOS entirely and becomes an unhandled
      // rejection in the middle of an emergency.
      attempt = req.transmitOnline().then(
        () => {
          lateOnlineSuccess = true;
        },
        () => undefined,
      );
      await withTimeout(attempt, ONLINE_ATTEMPT_TIMEOUT_MS, 'online dispatch');
      if (lateOnlineSuccess) {
        return {
          route: 'online',
          delivered: true,
          requiresUserAction: false,
          locationName,
          onlineFailureReason: null,
        };
      }
      // Settled inside the deadline but rejected. Fall through to SMS.
      onlineFailureReason = 'online dispatch failed';
    } catch (err) {
      onlineFailureReason = err instanceof Error ? err.message : String(err);
      console.warn('[sosTransport] online path failed, falling back to SMS', err);
    }
  }

  const sms = await dispatchOfflineSMSFallback(req.payload, req.emergencyContacts, {
    senderName: req.senderName,
    placeName: locationName,
  });

  // A short grace for the online attempt to land before we describe what
  // happened.
  //
  // Without it the flag was almost always false: the fallback returns in
  // milliseconds when there is no SMS hardware, so the result was built before
  // a request that was only a fraction of a second late could settle. Half a
  // second on top of the three we have already spent is worth paying to avoid
  // telling her to tap send when her circle has already been alerted.
  if (attempt && !lateOnlineSuccess) {
    await Promise.race([attempt, new Promise<void>((r) => setTimeout(r, LATE_GRACE_MS))]);
  }

  return {
    route: lateOnlineSuccess ? 'online_late' : sms.success ? 'sms' : 'none',
    // If the online path landed late, the alarm IS out regardless of what the
    // composer did.
    delivered: sms.success || lateOnlineSuccess,
    requiresUserAction: sms.requiresUserAction && !lateOnlineSuccess,
    locationName,
    onlineFailureReason,
    lateOnlineSuccess,
    sms,
  };
}

/**
 * One sentence for the screen. The UI must show something true here, and
 * "delivered" is not the same sentence for every route.
 *
 * A failure must never read like the good state. That is the recurring bug class
 * in this project, and the SOS screen is the worst place for it.
 */
export function describeTransportResult(r: TransportResult): string {
  // A late online success outranks whatever the SMS path reported. Telling her
  // to tap send when her circle has already been alerted is a worse error than
  // the duplicate itself.
  if (r.lateOnlineSuccess) {
    return 'Your circle and nearby helpers have been alerted.';
  }
  switch (r.route) {
    case 'online':
      return 'Your circle and nearby helpers have been alerted.';
    case 'sms':
      return r.requiresUserAction
        ? 'No data connection. Your message is ready to send, tap send in the SMS screen.'
        : 'No data connection. Your emergency contacts have been texted.';
    case 'none':
    default:
      return 'Could not reach anyone yet. Call 112 now.';
  }
}
