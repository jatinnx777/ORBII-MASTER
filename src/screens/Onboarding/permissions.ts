import { PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { requestNotificationPermission } from '@/services/notifications';

/**
 * The two permissions ORBII cannot work without, plus notifications.
 *
 * Asked on the last onboarding screen, after five screens have explained what
 * each one is for. Asking on launch, before any of that, is how apps get
 * refused: a microphone prompt from an app you have not used yet reads as
 * surveillance, and Android only lets you ask twice.
 *
 * ORDER MATTERS. Microphone first, because it is the one the whole product
 * rests on and the one the user has just been told about. Then location, which
 * Android will not grant in the background until foreground is granted. Then
 * notifications, which is the least consequential and the most likely to be
 * dismissed, so it goes last where a refusal costs nothing.
 *
 * NEVER THROWS, and never blocks. A refusal is a legitimate answer: onboarding
 * ends either way and the app raises each one again later, in the place where
 * it actually matters, which is where people say yes.
 */
export async function requestOnboardingPermissions(): Promise<{
  mic: boolean;
  location: boolean;
  notifications: boolean;
}> {
  const out = { mic: false, location: false, notifications: false };

  try {
    // Requested directly rather than through voice-detection, whose own
    // ensureMicPermission is private and fires as a side effect of starting the
    // recogniser. Onboarding needs the prompt without the microphone actually
    // opening.
    if (Platform.OS === 'android') {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      out.mic = r === PermissionsAndroid.RESULTS.GRANTED;
    } else {
      out.mic = true;
    }
  } catch {
    // Denied, or the module is unavailable on this build.
  }

  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    out.location = fg.granted;
    // Background is asked for separately and only if foreground was granted,
    // because Android rejects it otherwise. Deliberately not insisted on here:
    // "allow all the time" is a heavy ask on first run and Voice SOS works
    // without it while the app is open.
    if (fg.granted && Platform.OS === 'android') {
      await Location.requestBackgroundPermissionsAsync().catch(() => undefined);
    }
  } catch {
    // Location services off at the OS level.
  }

  try {
    out.notifications = await requestNotificationPermission();
  } catch {
    // ignore
  }

  return out;
}
