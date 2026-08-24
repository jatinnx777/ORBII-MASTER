import { supabase } from './supabase';

/**
 * Helper Network coverage.
 *
 * THIS IS NOT AN EXPRESS CONTROLLER, deliberately. ORBII has no Node server:
 * the React Native client calls Supabase RPCs directly, and the only
 * server-side code is Deno edge functions. An Express route would be a service
 * to deploy, secure, scale and pay for, sitting between a client and a database
 * that are already talking to each other with RLS in between.
 *
 * The validation a controller would do lives in two places instead, and both
 * are load-bearing:
 *   - here, so a bad reading never leaves the device
 *   - in check_helper_network_availability (sql/83), because a client is not a
 *     security boundary and anybody can call the RPC directly
 *
 * WHAT IS GATED, AND WHAT IS NOT. Only the Community Helper Network. Voice SOS,
 * the SMS relay, circle alerts, evidence recording and 112 run everywhere on
 * earth and nothing in this file can switch them off. If you find yourself
 * reaching for `coverage` to decide whether to fire an SOS, stop: that is the
 * bug this comment exists to prevent.
 */

export type CoverageStatus =
  | 'FULL_SHIELD_ACTIVE'
  | 'LOW_COVERAGE'
  | 'OUT_OF_COVERAGE'
  | 'INVALID_LOCATION'
  /** Offline, timed out, or the request failed. Never means "no helpers". */
  | 'OFFLINE_PERSONAL_SHIELD';

export type Coverage = {
  isInServiceArea: boolean;
  helperNetworkAvailable: boolean;
  nearbyHelpersCount: number;
  areaName: string | null;
  status: CoverageStatus;
  message: string;
};

/**
 * What we show when we genuinely do not know.
 *
 * Note `helperNetworkAvailable: false` but a message that does not claim the
 * network is absent. Telling somebody the network is unavailable because a
 * request timed out is a lie in the direction that costs the most, and the
 * fallback text is written so it stays true either way.
 */
const OFFLINE: Coverage = {
  isInServiceArea: false,
  helperNetworkAvailable: false,
  nearbyHelpersCount: 0,
  areaName: null,
  status: 'OFFLINE_PERSONAL_SHIELD',
  message:
    'Personal Shield Active (Offline Mode). Core Voice SOS & SMS Alerts are fully ready.',
};

/** Rejects nulls, NaN, infinities and impossible ranges. */
function isPlausible(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    // Null Island. A real fix is never exactly 0,0; this is what a failed
    // geocode or an uninitialised struct looks like, and treating it as a
    // location once put a user "in the Atlantic" on our own map.
    !(lat === 0 && lng === 0)
  );
}

export async function checkCoverage(
  lat: number,
  lng: number,
  opts: { timeoutMs?: number } = {},
): Promise<Coverage> {
  if (!isPlausible(lat, lng)) {
    return {
      ...OFFLINE,
      status: 'INVALID_LOCATION',
      message:
        'We could not read your location. Personal Shield (Voice SOS, SMS, family alerts) is still fully active.',
    };
  }

  // Three seconds. This is a cosmetic pill on the home screen, and on a patchy
  // Indian mobile connection an un-timed Supabase call can hang far longer than
  // anybody will wait to learn something that changes nothing they can do.
  const timeoutMs = opts.timeoutMs ?? 3000;

  try {
    // A coverage check is a cosmetic card. It must never hold the UI, and on a
    // patchy Indian mobile connection an un-timed Supabase call can hang for
    // far longer than anybody will wait.
    const result = await Promise.race([
      supabase.rpc('check_helper_network_availability', {
        user_lat: lat,
        user_lng: lng,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('coverage-timeout')), timeoutMs),
      ),
    ]);

    const { data, error } = result as { data: unknown; error: unknown };
    if (error || !data) return OFFLINE;

    const d = data as Record<string, unknown>;
    const status = String(d.status_code ?? 'UNKNOWN') as CoverageStatus;

    return {
      isInServiceArea: Boolean(d.is_in_delhi_ncr),
      helperNetworkAvailable: Boolean(d.helper_network_available),
      nearbyHelpersCount: Number(d.nearby_helpers_count ?? 0),
      areaName: d.area_name ? String(d.area_name) : null,
      status,
      message: String(d.message ?? OFFLINE.message),
    };
  } catch {
    // Timeout, offline, or a malformed payload. All three mean the same thing
    // to the user, and crucially none of them mean "no helpers exist near you".
    // The copy is written so it stays true either way.
    return OFFLINE;
  }
}

/**
 * Should the UI offer anything helper-related at all?
 *
 * LOW_COVERAGE deliberately returns true. Inside a live area with two helpers
 * on duty instead of three, the honest thing is to show the card saying it is
 * quiet right now, not to hide the feature as though it does not exist here.
 */
export function shouldShowHelperUI(c: Coverage): boolean {
  return c.status === 'FULL_SHIELD_ACTIVE' || c.status === 'LOW_COVERAGE';
}

/** The starting value, before any check has run. Never blocks anything. */
export const INITIAL_COVERAGE: Coverage = OFFLINE;

/**
 * Metres between two points, equirectangular.
 *
 * Used only to decide whether the user has moved far enough to re-check, so
 * the error against a proper haversine (metres, at city scale) is irrelevant
 * and this runs on every position update.
 */
export function metresBetween(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const mid = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const x = dLng * Math.cos(mid);
  return Math.round(Math.sqrt(x * x + dLat * dLat) * R);
}
