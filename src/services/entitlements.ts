// Which features need ORBII Plus (₹149/month). Everything not listed here is
// free for all users. `profile.isPremium` flips on after a successful Razorpay
// purchase (or the launch coupon).
//
// Pure `canUse` so it can be called from anywhere; `useEntitlement` is the
// component-friendly hook wired to the redux profile.

import { useAppSelector } from '@/redux/store';

export type Feature =
  // Family & Circles
  | 'circle_create' // owning MORE than FREE_CIRCLE_LIMIT circles
  | 'circle_geofencing' // circle EXTRA: safe zones ("did you mean to leave?")
  | 'live_location' // seeing your circle on the map day to day
  | 'video_evidence' // recording video during an SOS
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
  'live_location',
  'video_evidence',
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
  // 'disaster_mode' was here, and it was indefensible.
  //
  // ALWAYS_GATED overrides EARLY_ACCESS_UNLOCK, so disaster mode was paid-only
  // for every user. That means during a flood, someone opening ORBII to tell
  // their family they are alive would have been shown a subscription screen.
  //
  // Charge for unlimited responder dispatch. Never charge somebody for saying
  // "I am safe".

  // 'community' has now gone the same way, for a different reason.
  //
  // A community is worth what its density is worth, and a paywall in front of
  // an empty room guarantees it stays empty: the people who would have posted
  // first are exactly the ones who will not pay to find out whether anyone
  // else is there. Charging for it was charging for a thing that does not
  // exist yet, and the price was that it never would.
  //
  // Free until there are people in it. Whether it is ever worth charging for
  // is a question that can only be answered once it is full.
  'circle_geofencing',
  // THE LINE IS EMERGENCY VERSUS EVERYDAY.
  //
  // Free covers the thing ORBII exists for: build a circle, and when you fire
  // an SOS they are alerted with your live location, hands-free if you use
  // Voice SOS. None of that is behind a price, and it never should be.
  //
  // Paid covers seeing each other on an ordinary Tuesday. Continuous live
  // location, safe-zone alerts, and video evidence are conveniences layered on
  // top of a pipeline that already works without them.
  //
  // Note this does NOT touch the emergency override in sql/118. An active SOS
  // releases a live location to the circle whatever the sharing setting says
  // and whatever the tier, because a paywall between a woman in trouble and
  // the people trying to reach her is not a business model.
  'live_location',
  'video_evidence',
]);

// Free tier: up to 3 emergency contacts.
export const FREE_CONTACT_LIMIT = 3;

/**
 * Circles a free account may OWN.
 *
 * One, not zero. A safety app whose first screen is a subscription page is an
 * app nobody sets up, and a circle with nobody in it protects nobody. The
 * first one is free so the pipeline can exist; a second circle is a
 * convenience for somebody already getting value from the first.
 *
 * Being IN somebody else's circle has never counted against this and never
 * will. You cannot be charged for being on your mother's list.
 */
export const FREE_CIRCLE_LIMIT = 1;

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
