import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { addNotification } from './notification-inbox';

let configured = false;
const PINNED_SHORTCUT_ID = 'orbii-sos-shortcut';
const PINNED_SHORTCUT_CATEGORY = 'orbii-sos-shortcut';
const LISTENING_BADGE_ID = 'orbii-voice-listening';
const VOICE_WAKE_ID = 'orbii-voice-wake';
const SAFE_JOURNEY_ID = 'orbii-safe-journey';
const SAFE_JOURNEY_CATEGORY = 'orbii-safe-journey';
const GEOFENCE_LEAVE_CATEGORY = 'orbii-geofence-leave';
const VOICE_EXPIRY_CATEGORY = 'orbii-voice-expiry';

// Reminders fired before a time-boxed Voice SOS session ends, so protection
// never lapses silently. Stable ids let us cancel/replace them on re-arm.
const VOICE_EXPIRY_REMINDERS = [
  { id: 'orbii-voice-expiry-60', mins: 60, label: '1 hour' },
  { id: 'orbii-voice-expiry-30', mins: 30, label: '30 minutes' },
  { id: 'orbii-voice-expiry-10', mins: 10, label: '10 minutes' },
];

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
      // Aggressive 3-second vibration burst, meant to grab attention
      // even from a pocket. Pattern is wait/buzz pairs in ms.
      vibrationPattern: [0, 800, 200, 800, 200, 800, 200, 800],
      enableVibrate: true,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#FF0000',
      // Its OWN tone, not the system default. This is the one alert a helper
      // must be able to identify without looking at the screen: two tones a
      // fourth apart alternating at 5 Hz, which reads as urgent and carries
      // through a pocket. res/raw/helper_alert.wav, referenced without the
      // extension as Android requires.
      sound: 'helper_alert',
    }).catch(() => undefined);
    // Safe zone crossed. Important, but NOT an emergency: someone leaving their
    // college is worth knowing, not worth a siren. Default importance, no DND
    // bypass, a safety app that buzzes like an SOS for routine events trains
    // people to ignore the real one.
    Notifications.setNotificationChannelAsync('safe-zone', {
      name: 'Geofence alerts',
      description: 'When someone in your circle leaves a geofenced area.',
      // HIGH so a "left the area" alert heads-up over whatever they're doing,
      // for everyone in the circle, not just a silent tray entry.
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 350, 150, 350],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      lightColor: '#8672CE',
      sound: 'default',
    }).catch(() => undefined);
    // Someone GOT somewhere. Its own channel, and deliberately quieter than the
    // one above.
    //
    // A departure can escalate and has to interrupt. An arrival is reassurance,
    // and reassurance that heads-up over what you were doing stops being
    // reassuring by the fourth time in a day. DEFAULT importance puts it in the
    // tray without taking the screen, and a separate channel means anyone who
    // finds arrivals noisy can silence exactly those in Android settings
    // without losing the alert that matters.
    Notifications.setNotificationChannelAsync('safe-zone-arrival', {
      name: 'Arrival alerts',
      description: 'When someone in your circle reaches a place you watch.',
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      lightColor: '#8672CE',
      sound: 'default',
    }).catch(() => undefined);
    // YOU left a zone someone set for you. Aimed at the fenced person, not the
    // watcher: a deliberately DIFFERENT, unmistakable buzz (long-short-long) so
    // it doesn't feel like a normal safe-zone ping, because she needs to answer
    // "did I mean to leave?" MAX importance + DND bypass so the prompt lands.
    Notifications.setNotificationChannelAsync('geofence-leave', {
      name: 'You left a zone',
      description: 'When you leave a zone someone set for you, so you can confirm it was intentional.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 600, 300, 200, 300, 600],
      enableVibrate: true,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      lightColor: '#8672CE',
      sound: 'default',
    }).catch(() => undefined);
    // Incoming help request for a VERIFIED HELPER, someone nearby needs them
    // right now. Max importance so it wakes the screen and heads-up over the
    // lock screen even if the app has been closed all day. Separate channel so
    // the user can't silence family SOS and stranger requests together, and so
    // it reads distinctly. bypassDnd: a life-safety call must ring through.
    Notifications.setNotificationChannelAsync('incoming_sos', {
      name: 'Incoming help requests',
      description: 'Someone nearby needs your help right now.',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 800, 200, 800, 200, 800, 200, 800],
      enableVibrate: true,
      bypassDnd: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#FF0000',
      // Its OWN tone, not the system default. This is the one alert a helper
      // must be able to identify without looking at the screen: two tones a
      // fourth apart alternating at 5 Hz, which reads as urgent and carries
      // through a pocket. res/raw/helper_alert.wav, referenced without the
      // extension as Android requires.
      sound: 'helper_alert',
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
    // "Listening" badge channel, silent, low-importance ongoing notification
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
    // Reminder that always-on Voice SOS is about to turn itself off (the user
    // armed it for a fixed window). Important enough to head-up so she can keep
    // it on, but NOT an emergency: no DND bypass, a gentle double-buzz, so it
    // never feels like a real SOS.
    Notifications.setNotificationChannelAsync('voice-expiry', {
      name: 'Voice SOS reminders',
      description: 'Reminds you before background Voice SOS turns off, so you can keep it on.',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 300, 150, 300],
      enableVibrate: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      lightColor: '#8672CE',
      sound: 'default',
    }).catch(() => undefined);
  }
  // "Keep it on" action on a Voice SOS expiry reminder, opens the app so she
  // can re-arm before protection lapses.
  Notifications.setNotificationCategoryAsync(VOICE_EXPIRY_CATEGORY, [
    {
      identifier: 'voice-extend',
      buttonTitle: 'Keep listening',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
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
  // Actions on the "you left a zone" prompt: confirm it was intentional (clears
  // the alert), or flag it so the person who set the zone is told.
  Notifications.setNotificationCategoryAsync(GEOFENCE_LEAVE_CATEGORY, [
    {
      identifier: 'gf-authorized',
      buttonTitle: 'Yes, I meant to',
      options: { opensAppToForeground: false },
    },
    {
      identifier: 'gf-alert',
      buttonTitle: 'Alert my circle',
      options: { opensAppToForeground: true },
    },
  ]).catch(() => undefined);
  // Tap-actions on the Safe Journey lock-screen widget.
  Notifications.setNotificationCategoryAsync(SAFE_JOURNEY_CATEGORY, [
    {
      identifier: 'safe-arrived',
      buttonTitle: "I'm safe",
      options: { opensAppToForeground: true },
    },
    {
      identifier: 'extend-eta',
      buttonTitle: '+15 min',
      options: { opensAppToForeground: false },
    },
  ]).catch(() => undefined);

  if (Platform.OS === 'android') {
    Notifications.setNotificationChannelAsync('safe-journey', {
      name: 'Safe Journey',
      description: 'Live status of an active Safe Journey trip.',
      importance: Notifications.AndroidImportance.LOW,
      vibrationPattern: [0],
      enableVibrate: false,
      sound: null,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    }).catch(() => undefined);
  }
}

// Lock-screen Safe Journey widget. Posts a persistent notification with
// the live ETA + an "I'm safe" action button so the user (and anyone
// glancing at the lock screen) can see and dismiss the trip without
// unlocking the phone.
//
// Re-call this whenever the ETA changes, same identifier means it
// updates in place rather than stacking.
export async function showSafeJourneyWidget(args: {
  label: string;
  etaMs: number;
}): Promise<void> {
  configure();
  const etaText = new Date(args.etaMs).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const remainingMs = args.etaMs - Date.now();
  const minsLeft = Math.max(0, Math.round(remainingMs / 60000));
  const body =
    remainingMs > 0
      ? `ETA ${etaText} · ${minsLeft} min remaining`
      : `Should have arrived at ${etaText}`;
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: SAFE_JOURNEY_ID,
      content: {
        title: `Safe Journey · ${args.label}`,
        body,
        categoryIdentifier: SAFE_JOURNEY_CATEGORY,
        data: { kind: 'safe_journey_widget' },
        sticky: true,
        autoDismiss: false,
        ...(Platform.OS === 'android'
          ? {
              priority: Notifications.AndroidNotificationPriority.LOW,
              color: '#E0AC63',
            }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'safe-journey' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] safe journey widget failed', err);
  }
}

export async function hideSafeJourneyWidget(): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(SAFE_JOURNEY_ID);
  } catch {
    // ignore
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  configure();
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

/** Read the current notification permission WITHOUT prompting. */
export async function getNotificationPermission(): Promise<boolean> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    return existing.status === 'granted';
  } catch {
    return false;
  }
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
    // ignore, may already be gone
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

// Fired when we detect the phone killed the background listener and we've just
// re-armed it. Honest and actionable: it tells her it paused, that it's back,
// and offers the two OEM steps that stop it happening again. Uses the same
// non-emergency channel as the expiry reminders.
export async function fireVoiceGuardRecovered(): Promise<void> {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Your phone paused Voice SOS',
        body: 'ORBII is listening again. Tap for the 2 steps that stop your phone pausing it.',
        data: { kind: 'voice_oem_help' },
        sound: 'default',
        ...(Platform.OS === 'android'
          ? { priority: Notifications.AndroidNotificationPriority.HIGH, color: '#8672CE' }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'voice-expiry' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] voice recovery notice failed', err);
  }
  addNotification({
    title: 'Voice SOS was paused and restarted',
    body: 'Your phone paused ORBII in the background. Tap for steps to keep it running.',
    kind: 'system',
  }).catch(() => undefined);
}

// Cancel any pending Voice SOS expiry reminders. Called on re-arm (before
// rescheduling) and when protection is turned off.
export async function cancelVoiceExpiryReminders(): Promise<void> {
  await Promise.all(
    VOICE_EXPIRY_REMINDERS.map((r) =>
      Notifications.cancelScheduledNotificationAsync(r.id).catch(() => undefined),
    ),
  );
}

// Schedule the 1h / 30m / 10m "protection is about to end" reminders for a
// time-boxed background Voice SOS session. Any reminder whose fire time is
// already past (short sessions) is simply skipped. Re-arming replaces them.
export async function scheduleVoiceExpiryReminders(expiresAtMs: number): Promise<void> {
  configure();
  await cancelVoiceExpiryReminders();
  const now = Date.now();
  for (const r of VOICE_EXPIRY_REMINDERS) {
    const fireAt = expiresAtMs - r.mins * 60_000;
    if (fireAt <= now + 15_000) continue; // in the past / too soon to matter
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: r.id,
        content: {
          title: `Voice SOS ends in ${r.label}`,
          body:
            r.mins <= 10
              ? 'You’re about to be unprotected. Tap to keep ORBII listening.'
              : 'Tap to keep ORBII listening for a call for help.',
          data: { kind: 'voice_expiry' },
          categoryIdentifier: VOICE_EXPIRY_CATEGORY,
          sound: 'default',
          ...(Platform.OS === 'android'
            ? { priority: Notifications.AndroidNotificationPriority.HIGH, color: '#8672CE' }
            : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(fireAt),
          ...(Platform.OS === 'android' ? { channelId: 'voice-expiry' } : {}),
        },
      });
    } catch (err) {
      console.warn('[notifications] voice expiry reminder failed', err);
    }
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

// "You left <zone>" prompt for the fenced person, with a very different buzz and
// two actions (I meant to / alert my circle). Fired from the geofence exit
// handler. Carries the event id so the response can authorize or escalate it.
export async function presentGeofenceLeavePrompt(
  eventId: string,
  label: string,
  geofenceId: string,
): Promise<void> {
  configure();
  try {
    await Notifications.scheduleNotificationAsync({
      identifier: `orbii-gf-leave-${eventId}`,
      content: {
        title: `You left ${label}`,
        body: 'Did you mean to? Tap "Yes, I meant to" or alert your circle.',
        data: { kind: 'geofence_leave', eventId, label, geofenceId },
        sound: 'default',
        categoryIdentifier: GEOFENCE_LEAVE_CATEGORY,
        ...(Platform.OS === 'android'
          ? { priority: Notifications.AndroidNotificationPriority.MAX, color: '#8672CE' }
          : {}),
      },
      trigger: Platform.OS === 'android'
        ? ({ channelId: 'geofence-leave' } as Notifications.NotificationTriggerInput)
        : null,
    });
  } catch (err) {
    console.warn('[notifications] geofence leave prompt failed', err);
  }
}

export async function dismissGeofenceLeavePrompt(eventId: string): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(`orbii-gf-leave-${eventId}`);
  } catch {
    // ignore
  }
}
