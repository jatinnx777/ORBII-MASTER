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
  | 'priority_helpers';

const PREMIUM_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'circle_create',
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
]);

// Free tier: one custom voice trigger phrase. ORBII Plus: unlimited.
export const FREE_VOICE_PHRASE_LIMIT = 1;

// Free tier: up to 3 emergency contacts.
export const FREE_CONTACT_LIMIT = 3;

export function canUse(
  feature: Feature,
  ctx: { isPremium: boolean } = { isPremium: false },
): boolean {
  return PREMIUM_FEATURES.has(feature) ? ctx.isPremium : true;
}

export function useEntitlement(feature: Feature): boolean {
  const isPremium = useAppSelector((s) => s.user.profile?.isPremium ?? false);
  return canUse(feature, { isPremium });
}

/** True when the signed-in user is on ORBII Plus. */
export function useIsPremium(): boolean {
  return useAppSelector((s) => s.user.profile?.isPremium ?? false);
}
