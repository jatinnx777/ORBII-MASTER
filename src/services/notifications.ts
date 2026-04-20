import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { addNotification } from './notification-inbox';

let configured = false;
const PINNED_SHORTCUT_ID = 'orbii-sos-shortcut';
const PINNED_SHORTCUT_CATEGORY = 'orbii-sos-shortcut';

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
