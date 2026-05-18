// Single source of truth for which features a user can use.
//
// We deliberately keep this small and explicit — every feature gets a
// stable id, every call site goes through `canUse(feature)`. When
// subscriptions go live, only the body of `canUse` changes; no
// component code needs to be touched.
//
// Current state (startup mode):
//   • Everything open EXCEPT Crime Reports + Travel Heatmap.
//   • These two stay locked so we can validate the upgrade flow with
//     real users without burning the entire premium catalog.
//
// To restore full subscription gating later, replace the body of
// `canUse` with a tier-aware lookup against `profile.tier` (or whatever
// shape the entitlements server returns).

import { useAppSelector } from '@/redux/store';

export type Feature =
  | 'sos'
  | 'voice_sos'
  | 'hardware_sos'
  | 'safe_mode'
  | 'ghost_mode'
  | 'deadman_timer'
  | 'data_breach_alerts'
  | 'crime_reports'
  | 'travel_heatmap'
  | 'system_status'
  | 'friend_chat'
  | 'priority_dispatch'
  | 'location_share_24_7'
  | 'family_dashboard';

// The premium-locked set during the startup phase. Anything NOT in this
// set is open to all users.
const STARTUP_LOCKED: ReadonlySet<Feature> = new Set<Feature>([
  'crime_reports',
  'travel_heatmap',
]);

// Tier model (kept here so future paid plans can re-key into the same
// constants). Today only `crime_reports` (silver) and `travel_heatmap`
// (platinum) actually drive UI gating.
export type Tier = 'free' | 'silver' | 'gold' | 'platinum';

const FEATURE_TIER: Record<Feature, Tier> = {
  sos: 'free',
  voice_sos: 'free',
  hardware_sos: 'free',
  safe_mode: 'free',
  ghost_mode: 'silver',
  deadman_timer: 'silver',
  data_breach_alerts: 'free',
  crime_reports: 'silver',
  travel_heatmap: 'platinum',
  system_status: 'free',
  friend_chat: 'free',
  priority_dispatch: 'gold',
  location_share_24_7: 'platinum',
  family_dashboard: 'platinum',
};

// Pure function — easy to unit-test. Doesn't read redux directly so it
// can be called from anywhere (services, sagas, etc.).
export function canUse(
  feature: Feature,
  ctx: { isPremium: boolean } = { isPremium: false },
): boolean {
  // Startup-stage rule: locked set wins.
  if (STARTUP_LOCKED.has(feature)) {
    return ctx.isPremium;
  }
  // Everything else open during startup mode.
  return true;
}

export function tierFor(feature: Feature): Tier {
  return FEATURE_TIER[feature];
}

// React hook flavor — wires to the redux profile so components don't
// have to do the plumbing themselves. Use this in screens; use
// `canUse` directly from non-component code.
export function useEntitlement(feature: Feature): boolean {
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);
  return canUse(feature, { isPremium });
}

// Convenience for screens that need to know "is this row locked?"
// without negating manually at every call site.
export function useIsLocked(feature: Feature): boolean {
  return !useEntitlement(feature);
}
