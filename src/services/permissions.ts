import { Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { AudioModule } from 'expo-audio';

// Request the permissions ORBII needs, up front, one after another. Android
// shows these as a sequence of native dialogs (the OS won't stack them into one
// sheet), so from the user's side it's "grant, grant, grant" in a row right
// after the disclosure screen, no hunting for them later when an emergency is
// already happening.
//
// All best-effort: a denial never throws. Background location is deliberately
// NOT requested here, Google treats it as highly sensitive and it reads better
// asked in context (when she first arms an always-on feature).
export async function requestAllPermissions(): Promise<void> {
  if (Platform.OS !== 'android') return;

  // 1. Location (foreground), needed to send help to where she is.
  try {
    await Location.requestForegroundPermissionsAsync();
  } catch {
    /* denied / unavailable */
  }

  // 2. Microphone, hands-free Voice SOS.
  try {
    await AudioModule.requestRecordingPermissionsAsync();
  } catch {
    /* denied */
  }

  // 3. Notifications, so a circle SOS reaches her.
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    /* denied */
  }
}
