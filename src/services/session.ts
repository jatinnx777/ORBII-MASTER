import AsyncStorage from '@react-native-async-storage/async-storage';
import { SESSION_TTL_MS } from './supabase';

const LAST_ACTIVE_KEY = 'orbii:session:lastActiveAt';

export async function touchSession(): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  } catch (err) {
    console.warn('[session] touch failed', err);
  }
}

export async function getLastActiveAt(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ACTIVE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

export async function isSessionExpired(): Promise<boolean> {
  const last = await getLastActiveAt();
  if (!last) return false;
  return Date.now() - last > SESSION_TTL_MS;
}

export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
