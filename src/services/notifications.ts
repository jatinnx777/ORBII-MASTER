import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { addNotification } from './notification-inbox';

let configured = false;
const PINNED_SHORTCUT_ID = 'orbii-sos-shortcut';
const PINNED_SHORTCUT_CATEGORY = 'orbii-sos-shortcut';
const LISTENING_BADGE_ID = 'orbii-voice-listening';
const VOICE_WAKE_ID = 'orbii-voice-wake';

function configure() {
  if (configured) return;
  configured = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('sos', {
      name: 'SOS alerts',
      importance: Notifications.AndroidImportance.MAX,
      // Aggressive 3-second vibration burst — meant to grab attention
      // even from a pocket. Pattern is wait/buzz pairs in ms.
      vibrationPattern: [0, 800, 200, 800, 200, 800, 200, 800],
      enableVibrate: true,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#FF0000',
      sound: 'default',
    }).catch(() => undefined);
    // Lower-priority "ongoing" channel for the persistent SOS shortcut. We
    // want it visible on the lock screen and impossible to dismiss by swipe,
    // but it shouldn't make sound or vibrate (it's a shortcut, not an alert).
    Notifications.setNotificationChannelAsync('sos-shortcut', {
      name: 'Quick SOS shortcut',
      description: 'Always-visible button to fire an SOS in one tap.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0],
      enableVibrate: false,
      sound: null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    }).catch(() => undefined);
    // "Listening" badge channel — silent, low-importance ongoing notification
    // posted while always-on Voice SOS is active. Its primary purpose is to
    // give Android a visible reason to keep our process alive in the
    // background (battery-optimization carve-out for foreground-state apps).
    Notifications.setNotificationChannelAsync('voice-listening', {
      name: 'Voice SOS listening',
      description: 'Shown while ORBII is listening for help in the background.',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      enableVibrate: false,
      sound: null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    }).catch(() => undefined);
  }
  // Tap-actions on the persistent notification.
  Notifications.setNotificationCategoryAsync(PINNED_SHORTCUT_CATEGORY, [
    {
      identifier: 'send-sos',
      buttonTitle: 'Send SOS',
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'im-safe',
      buttonTitle: "I'm safe",
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
}

export async function requestNotificationPermission(): Promise<boolean> {
  configure();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

export async function fireLocalNotification(
  title: string,
  body: string,
  data?: Record<string, unknown>,
  kind: 'sos' | 'helper' | 'system' = 'system',
) {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
  } catch (err) {
    console.warn('[notifications] fire failed', err);
  }
  addNotification({ title, body, kind }).catch(() => undefined);
}

// Posts a persistent (ongoing) notification with a one-tap "Send SOS" action.
// On Android this stays visible on the lock screen and re-posts after device
// reboots when the app is opened again. Calling it multiple times safely
// updates the same notification instead of stacking.
export async function showPinnedSOSShortcut(): Promise<void> {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: PINNED_SHORTCUT_ID,
      content: {
        title: 'ORBII is protecting you',
        body: 'Tap "Send SOS" to alert nearby helpers instantly.',
        categoryIdentifier: PINNED_SHORTCUT_CATEGORY,
        data: { kind: 'sos_shortcut' },
        sticky: true,
        autoDismiss: false,
        ...(Platform.OS === 'android'
          ? {
              priority: Notifications.AndroidNotificationPriority.HIGH,
              color: '#FF0000',
            }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'sos-shortcut' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] pinned shortcut failed', err);
  }
}

export async function hidePinnedSOSShortcut(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(PINNED_SHORTCUT_ID);
  } catch {
    // ignore — may already be gone
  }
}

// Silent ongoing notification shown while always-on Voice SOS is enabled.
// Android treats apps with a foreground-style ongoing notification as more
// important than fully-backgrounded ones, which is what keeps the speech
// recognizer process alive when the screen is off.
export async function showListeningBadge(): Promise<void> {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: LISTENING_BADGE_ID,
      content: {
        title: 'ORBII is listening',
        body: 'Say "help", "bachao", or "madad" to fire an SOS.',
        data: { kind: 'voice_listening' },
        sticky: true,
        autoDismiss: false,
        ...(Platform.OS === 'android'
          ? {
              priority: Notifications.AndroidNotificationPriority.LOW,
              color: '#FF0000',
            }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'voice-listening' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] listening badge failed', err);
  }
}

export async function hideListeningBadge(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(LISTENING_BADGE_ID);
  } catch {
    // ignore
  }
}

// Hard wake-up notification for when a trigger word is heard while the phone
// is locked / app is backgrounded. Uses the high-priority SOS channel so the
// device vibrates aggressively, plays a sound, and shows the alert over the
// lock screen. Tapping it opens the app to the SOS countdown.
export async function fireVoiceWakeNotification(keyword: string): Promise<void> {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: VOICE_WAKE_ID,
      content: {
        title: `Heard "${keyword}", opening SOS`,
        body: 'Tap to confirm or cancel the 5-second countdown.',
        data: { kind: 'voice_trigger', keyword },
        sound: 'default',
        ...(Platform.OS === 'android'
          ? {
              priority: Notifications.AndroidNotificationPriority.MAX,
              color: '#FF0000',
            }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'sos' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] voice wake failed', err);
  }
}
