import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  onboarded: 'orbii:onboarded',
  history: 'orbii:history',
  helperEarnings: 'orbii:helper:earnings',
  helperVerified: 'orbii:helper:verified',
  settings: 'orbii:settings',
  profile: 'orbii:profile',
  notifications: 'orbii:notifications',
  premiumWaitlist: 'orbii:premium:waitlist',
  safetyModes: 'orbii:safety-modes',
  // Picovoice access key. Stored in SecureStore via the secure-store
  // hybrid adapter — see `orbii:secure:` prefix mapping.
  voiceAccessKey: 'orbii:secure:voice-access-key',
  voiceKeyword: 'orbii:voice-keyword',
  locale: 'orbii:locale',
  activeCircleId: 'orbii:circles:active',
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
