import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

/**
 * Push registration, into the same push_tokens table the main app writes to,
 * so notify-sos reaches this app with no backend change at all.
 *
 * ON iOS AND CRITICAL ALERTS. A normal notification obeys silent mode and Do
 * Not Disturb, which for an SOS at 2am is the difference between a parent
 * waking up and not. Apple's Critical Alerts entitlement bypasses both, and a
 * women's safety app is squarely who it exists for. It has to be requested
 * from Apple and granted per app, so it is not wired here yet: the request goes
 * in with the first TestFlight build, and this file is where it lands when it
 * is approved.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export async function registerForPush(): Promise<string | null> {
  // A simulator has no push token and never will. Reporting that plainly beats
  // a confusing failure later.
  if (!Device.isDevice) return null;

  try {
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== 'granted') return null;

    if (Platform.OS === 'android') {
      // Android needs a channel or the notification arrives silently, which on
      // this app means it may as well not arrive.
      await Notifications.setNotificationChannelAsync('sos', {
        name: 'Emergency alerts',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        vibrationPattern: [0, 400, 200, 400],
        bypassDnd: true,
      });
    }

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    if (!token) return null;

    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return token;

    // FIXED IN sql/127, and this comment used to describe the bug.
    //
    // push_tokens had user_id as its primary key, so it held exactly ONE token
    // per person and every registration replaced the previous device. A parent
    // with both ORBII and ORBII Circle installed would have had one of them go
    // quiet, and it would have been whichever they opened first: the app whose
    // entire job is receiving an emergency notification.
    //
    // The key is (user_id, token) now, so a person can hold as many devices as
    // they carry. Nothing downstream needed changing: every reader already did
    // `.select('token').in('user_id', ids)` and fans out over whatever rows
    // exist. updated_at is sent because the weekly prune uses it to decide
    // which tokens belong to apps nobody has opened in three months.
    await supabase.from('push_tokens').upsert(
      { user_id: uid, token, platform: Platform.OS, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,token' },
    );

    return token;
  } catch {
    // Never let push registration break the app. Someone who cannot receive a
    // notification can still open the app and see the alert list, which is
    // exactly why that list exists.
    return null;
  }
}
