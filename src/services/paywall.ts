
import { appAlert } from '@/components/common';

// Small helper to surface the ORBII Plus paywall consistently. Pass the
// feature name + a callback that navigates to the upgrade screen.
export function promptUpgrade(opts: {
  feature: string;
  body?: string;
  onUpgrade: () => void;
}): void {
  appAlert(
    'ORBII Plus',
    opts.body ??
      `${opts.feature} is part of ORBII Plus (₹149/month). Upgrade to unlock it and everything else in Plus.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Upgrade', onPress: opts.onUpgrade },
    ],
  );
}
