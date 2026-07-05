import { useMemo } from 'react';
import { useAppSelector } from '@/redux/store';

// Rule-based safety tips. Each tip is a function of real app state —
// nothing hardcoded as a static list. The Home card surfaces ONE tip
// at a time, the top-priority one. When the user dismisses it (future)
// we fall through to the next.
//
// Rules (in priority order):
//   1. Location off → "Enable location so helpers can find you."
//   2. No emergency contacts → "Add at least one emergency contact."
//   3. No friends in circle → "Invite a friend so your circle isn't empty."
//   4. Late night (10pm-5am) + at least one circle member → "Share your trip"
//   5. Many active alerts nearby → "There are alerts nearby. Stay aware."
//   6. Default: "Press SOS once to practice the flow."

export type SafetyTip = {
  id: string;
  title: string;
  body: string;
  cta: string;
  // Internal — what tapping the CTA should do. The Home component
  // decides the actual navigation based on `target`.
  target:
    | 'enable_location'
    | 'add_contact'
    | 'invite_friend'
    | 'share_trip'
    | 'community_alerts'
    | 'practice_sos';
};

export function useSafetyTips(): SafetyTip[] {
  const locationGranted = useAppSelector(
    (s) => s.sos.locationPermission === 'granted',
  );
  const contactsCount = useAppSelector(
    (s) => s.user.profile?.emergencyContacts?.length ?? 0,
  );
  const friendsCount = useAppSelector(
    (s) => s.user.profile?.friends?.length ?? 0,
  );
  const nearbyAlertsCount = useAppSelector(
    (s) => s.community.alerts.length,
  );

  return useMemo(() => {
    const tips: SafetyTip[] = [];
    if (!locationGranted) {
      tips.push({
        id: 'enable_location',
        title: 'Turn on location',
        body: 'Helpers can only reach you if we know where you are.',
        cta: 'Enable location',
        target: 'enable_location',
      });
    }
    if (contactsCount === 0) {
      tips.push({
        id: 'add_contact',
        title: 'Add one emergency contact',
        body: 'They get an SMS with your live location the moment you fire SOS.',
        cta: 'Add a contact',
        target: 'add_contact',
      });
    }
    if (friendsCount === 0) {
      tips.push({
        id: 'invite_friend',
        title: 'Your circle is empty',
        body: 'The people you add here can help faster during emergencies.',
        cta: 'Invite friends',
        target: 'invite_friend',
      });
    }
    const now = new Date();
    const hour = now.getHours();
    const isLateNight = hour >= 22 || hour < 5;
    if (isLateNight && friendsCount > 0) {
      tips.push({
        id: 'share_trip',
        title: 'Late-night trip?',
        body: 'Let your circle follow along with Safe Mode or Ghost Mode.',
        cta: 'Share a trip',
        target: 'share_trip',
      });
    }
    if (nearbyAlertsCount > 0) {
      tips.push({
        id: 'community_alerts',
        title:
          nearbyAlertsCount === 1
            ? 'Someone nearby needs help'
            : `${nearbyAlertsCount} alerts nearby`,
        body: 'Tap to see who and how close. Your help saves the most time.',
        cta: 'See alerts',
        target: 'community_alerts',
      });
    }
    if (tips.length === 0) {
      tips.push({
        id: 'practice_sos',
        title: 'Try a practice SOS',
        body: 'Run the SOS flow once so you know what to expect. No alerts sent.',
        cta: 'Practice now',
        target: 'practice_sos',
      });
    }
    return tips;
  }, [locationGranted, contactsCount, friendsCount, nearbyAlertsCount]);
}
