import { appAlert } from '@/components/common';
import { trackEvent } from './analytics';

// A single, honest "not built yet" dialog.
//
// This is deliberately blunt. On a safety app the worst possible thing is a
// button that looks live and isn't, because someone counts on it in the moment
// it matters. So we say plainly that it doesn't work yet and to not rely on it.
// It also logs interest, so we learn which of these people actually want.
export function comingSoon(feature: string, detail?: string): void {
  trackEvent('coming_soon_tapped', { feature });
  appAlert(
    `${feature} is coming soon`,
    detail ??
      "We're still building this, so it isn't live yet. Please don't rely on it in an emergency, use SOS or call 112.",
  );
}
