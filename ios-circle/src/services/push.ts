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

    // KNOWN LIMITATION, and it is not this app's to fix alone.
    //
    // push_tokens has user_id as its PRIMARY KEY (sql/20), so it holds exactly
    // ONE token per person. If somebody installs both ORBII and ORBII Circle,
    // or ORBII on two phones, the newer registration overwrites the older and
    // the first device silently stops receiving alerts.
    //
    // That is already true of the main app today; this app only makes it easy
    // to hit. The fix is a composite key on (user_id, token) plus notify-sos
    // sending to every token a user has, and it has to be done as one change
    // across the table and the edge function, not quietly from here.
    await supabase
      .from('push_tokens')
      .upsert({ user_id: uid, token, platform: Platform.OS }, { onConflict: 'user_id' });

    return token;
  } catch {
    // Never let push registration break the app. Someone who cannot receive a
    // notification can still open the app and see the alert list, which is
    // exactly why that list exists.
    return null;
  }
}
