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
  inviteSeen: 'orbii:circles:invite-seen',
  voiceUsage: 'orbii:voice-usage',
  bgVoice: 'orbii:bg-voice',
  voiceLang: 'orbii:voice-lang',
  fsiAsked: 'orbii:fsi-asked',
  disclosureAck: 'orbii:disclosure-ack',
  guidedSetup: 'orbii:guided-setup-done',
  sosQueue: 'orbii:sos-queue',
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
