// Which features need a paid plan. Everything not listed here is free for
// all users. The launch coupon (ORBII) flips the account to premium, which
// unlocks every premium feature.
//
// Pure `canUse` so it can be called from anywhere; `useEntitlement` is the
// component-friendly hook wired to the redux profile.

import { useAppSelector } from '@/redux/store';

export type Feature = 'ghost_mode' | 'deadman_timer';

const PREMIUM_FEATURES: ReadonlySet<Feature> = new Set<Feature>([
  'ghost_mode',
  'deadman_timer',
]);

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
