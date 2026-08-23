import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Hybrid storage that Supabase plugs into. Auth tokens (anything starting
// with `sb-`) live in SecureStore, Android Keystore / iOS Keychain
// backed, encrypted at rest. Everything else stays on AsyncStorage so
// behaviour is unchanged for non-sensitive cache.
//
// Why hybrid: SecureStore on Android has a 2KB per-key size cap. Supabase
// session payloads typically fit comfortably under that, but the rest of
// the app's persisted state (history, settings) does not. AsyncStorage is
// fine for cache; SecureStore is the right home for credentials.

// NOTE: SecureStore only accepts keys of alphanumerics, '.', '-' and '_'.
// The original prefix here was 'orbii:secure:', whose colons are illegal, so
// every key using it threw on write, hit the catch below and silently landed
// in plain AsyncStorage instead. The prefix is underscore-separated now so it
// is actually a legal key. 'sb-' was always fine, so Supabase tokens really
// were in the keystore. See safety-pin.ts for the migration off the old key.
const SECURE_KEY_PREFIXES = ['sb-', 'orbii_secure_'];

function isSensitive(key: string): boolean {
  return SECURE_KEY_PREFIXES.some((p) => key.startsWith(p));
}

const secureSupported = Platform.OS === 'android' || Platform.OS === 'ios';

export const secureStorage = {
  getItem: async (key: string): Promise<string | null> => {
    if (secureSupported && isSensitive(key)) {
      try {
        const v = await SecureStore.getItemAsync(key);
        return v ?? null;
      } catch (err) {
        // Keystore can throw on locked-screen / corrupt keystore. Fall
        // through to AsyncStorage so the user isn't locked out.
        console.warn('[secure-store] getItem fallback', key, err);
      }
    }
    return AsyncStorage.getItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (secureSupported && isSensitive(key)) {
      try {
        await SecureStore.setItemAsync(key, value);
        // Clean stale plaintext copy from AsyncStorage if it was there
        // before the secure-store upgrade landed.
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return;
      } catch (err) {
        console.warn('[secure-store] setItem fallback', key, err);
      }
    }
    await AsyncStorage.setItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (secureSupported && isSensitive(key)) {
      try {
        await SecureStore.deleteItemAsync(key);
      } catch {
        // ignore
      }
    }
    await AsyncStorage.removeItem(key).catch(() => undefined);
  },
};
