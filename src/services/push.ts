import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

// Remote push registration. Stores this device's Expo push token against the
// signed-in user so the `notify-sos` edge function can reach them when someone
// in their circle fires an SOS — even if their app is closed.
//
// IMPORTANT (setup): Android push needs Firebase Cloud Messaging configured for
// this project. Until that's done, `getExpoPushTokenAsync` throws and we simply
// skip (no crash); the realtime/WhatsApp paths still work. See PUSH_SETUP.md.

let lastRegisteredFor: string | null = null;

export async function registerPushToken(userId: string): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!userId || lastRegisteredFor === userId) return;
  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted;
    }
    if (!granted) return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;

    const resp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const token = resp.data;
    if (!token) return;

    const { error } = await supabase.from('push_tokens').upsert(
      {
        user_id: userId,
        token,
        platform: 'android',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (!error) lastRegisteredFor = userId;
  } catch (err) {
    // FCM not configured yet, permission denied, or offline — non-fatal.
    console.warn('[push] token registration skipped:', err);
  }
}

export function resetPushRegistration(): void {
  lastRegisteredFor = null;
}
