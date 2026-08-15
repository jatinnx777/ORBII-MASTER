// Which features need ORBII Plus (₹99/month). Everything not listed here is
// free for all users. `profile.isPremium` flips on after a successful Razorpay
// purchase (or the launch coupon).
//
// Pure `canUse` so it can be called from anywhere; `useEntitlement` is the
// component-friendly hook wired to the redux profile.

import { useAppSelector } from '@/redux/store';

export type Feature =
  // Family & Circles
  | 'circle_create' // creating / owning a family circle
  | 'circle_geofencing' // circle EXTRA: safe zones ("did you mean to leave?")
  // Advanced voice protection
  | 'unlimited_voice_phrases' // more than one trigger phrase
  | 'background_voice' // background voice monitoring
  // Advanced protection / SOS / helper / premium extras
  | 'advanced_protection'
  | 'deadman_timer'
  | 'ghost_mode'
  | 'trusted_places'
  | 'whatsapp_automation'
  | 'scheduled_checkins'
  | 'safe_route'
  | 'priority_helpers'
  // Plus-only sections (gated NOW, even during early access)
  | 'disaster_mode'
  | 'community';

const PREMIUM_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'circle_create',
  'circle_geofencing',
  'unlimited_voice_phrases',
  'background_voice',
  'advanced_protection',
  'deadman_timer',
  'ghost_mode',
  'trusted_places',
  'whatsapp_automation',
  'scheduled_checkins',
  'safe_route',
  'priority_helpers',
  'disaster_mode',
  'community',
]);

// Features that are Plus-only RIGHT NOW, even while EARLY_ACCESS_UNLOCK is on.
// Everything else stays free during early access; these are the sections the
// founder chose to make premium (Disaster mode, ORBII Community, and the circle
// EXTRA of safe-zone geofencing, basic circles stay free). Unlock is via the
// launch coupon (checkout) until Play Billing is wired.
const ALWAYS_GATED: ReadonlySet<Feature> = new Set<Feature>([
  'disaster_mode',
  'community',
  'circle_geofencing',
]);

// Free tier: up to 3 emergency contacts.
export const FREE_CONTACT_LIMIT = 3;

// During early access, everything EXCEPT the always-gated set is unlocked and
// free (no in-app billing yet, which also keeps us clear of Google Play's
// billing policy). Flip this to false when paid subscriptions go live.
export const EARLY_ACCESS_UNLOCK = true;

export function canUse(
  feature: Feature,
  ctx: { isPremium: boolean } = { isPremium: false },
): boolean {
  // The always-gated set requires Plus regardless of early access.
  if (ALWAYS_GATED.has(feature)) return ctx.isPremium;
  if (EARLY_ACCESS_UNLOCK) return true;
  return PREMIUM_FEATURES.has(feature) ? ctx.isPremium : true;
}

export function useEntitlement(feature: Feature): boolean {
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);
  return canUse(feature, { isPremium });
}

/** True when the signed-in user is on ORBII Plus. */
export function useIsPremium(): boolean {
  return useAppSelector((s) => EARLY_ACCESS_UNLOCK || (s.user.profile?.isPremium ?? false));
}
