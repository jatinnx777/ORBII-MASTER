import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

let configured = false;

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
      vibrationPattern: [0, 400, 200, 400],
      lightColor: '#FF0000',
      sound: 'default',
    }).catch(() => undefined);
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  configure();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

export async function fireLocalNotification(title: string, body: string, data?: Record<string, unknown>) {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: null,
    });
  } catch (err) {
    console.warn('[notifications] fire failed', err);
  }
}
