import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  onboarded: 'orbii:onboarded',
  history: 'orbii:history',
  settings: 'orbii:settings',
  profile: 'orbii:profile',
  notifications: 'orbii:notifications',
  premiumWaitlist: 'orbii:premium:waitlist',
  premiumCoupon: 'orbii:premium:coupon-at',
  premiumTier: 'orbii:premium:tier',
  contactMatch: 'orbii:contact-match-enabled',
  contactMatchAt: 'orbii:contact-match-at',
  safetyTest: 'orbii:safety-test-done',
  safetyModes: 'orbii:safety-modes',
  locale: 'orbii:locale',
  activeCircleId: 'orbii:circles:active',
  // Stale-while-revalidate caches. These exist so a returning user sees their
  // circles, their members and the feed at frame one instead of an empty list
  // that fills in when the network replies. They are a rendering convenience
  // and never a source of truth: the server overwrites them on every refresh,
  // and anything read from them is already on screen by the time it is checked.
  //
  // Nothing here is sensitive beyond what the account already sees. Locations
  // are deliberately NOT cached: a member's last known position is the one
  // thing that must never be shown stale on a safety app, because a pin from
  // forty minutes ago looks exactly like a pin from now.
  circlesList: 'orbii:circles:list',
  circleMembers: 'orbii:circles:members',
  feedPosts: 'orbii:community:feed',
  // Last known positions, so the map paints pins on the first frame instead of
  // after a round trip. Cached deliberately despite the rule against stale
  // locations elsewhere: the pins carry age_seconds and unreachable with them
  // (sql/118), so a restored position announces how old it is rather than
  // pretending to be live. That is the difference between a cache and a lie.
  memberLocations: 'orbii:circles:locations',
  inviteSeen: 'orbii:circles:invite-seen',
  voiceUsage: 'orbii:voice-usage',
  bgVoice: 'orbii:bg-voice',
  voiceSessionId: 'orbii:voice-session-id',
  voiceGuardArmed: 'orbii:voice-guard-armed',
  voiceGuardArmedAt: 'orbii:voice-guard-armed-at',
  voiceGuardExpiresAt: 'orbii:voice-guard-expires-at',
  voiceLang: 'orbii:voice-lang',
  fsiAsked: 'orbii:fsi-asked',
  overlayAsked: 'orbii:overlay-asked',
  disclosureAck: 'orbii:disclosure-ack',
  guidedSetup: 'orbii:guided-setup-done',
  // Survival battery mode. Outlives an app session because a disaster does.
  survivalMode: 'orbii:survival-mode',
  // Crash and fall detection, off until the person turns it on.
  //
  // A stored preference rather than a build constant, because the thresholds
  // in volumetricShock.ts have never been measured on a phone ORBII ships to.
  // Arming it had to be something one person can do on one handset to find
  // out, not a release that arms it for everybody at once.
  impactDetection: 'orbii:impact-detection',
  // The two screens before sign-in: language, then what ORBII is.
  introDone: 'orbii:intro-done',
  onboardingLang: 'orbii:onboarding-lang',
  sosQueue: 'orbii:sos-queue',
  // Ten booleans. Whether this user's voice triggers tend to be real.
  voiceOutcomes: 'orbii:voice-outcomes',
} as const;

export const storageKeys = KEYS;

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.warn('[storage] getItem failed', key, err);
    return null;
  }
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[storage] setItem failed', key, err);
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch (err) {
    console.warn('[storage] removeItem failed', key, err);
  }
}
