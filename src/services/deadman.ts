import * as Notifications from 'expo-notifications';
import { store } from '@/redux/store';
import {
  deadmanArmed,
  deadmanDisarmed,
  deadmanExtended,
} from '@/redux/slices/safetyModesSlice';
import { addBreadcrumb, reportError } from './error-reporting';

// Deadman Timer service. Schedules two local notifications:
//   • REMINDER, fires 90s before expiry. "Tap to extend or confirm safe."
//   • EXPIRY, fires at expiry. Tells the user the alert went out.
//
// Reminder + expiry IDs are stored on the redux state so disarm/extend
// can cancel them. The actual auto-SOS at expiry is fired by the
// active screen (when foregrounded) or by a deferred-launch handler
// when the user taps the expiry notification cold-start.
//
// Background reliability: a JS-side setTimeout dies when the app is
// killed, but Notifications.scheduleNotificationAsync hands the alarm
// to the Android AlarmManager which DOES survive. So even if ORBII is
// force-stopped, the user still gets the expiry notification at the
// right second, and tapping it lands them in the app to fire the SOS.

const REMINDER_LEAD_MS = 90_000;

export type ArmTimerArgs = {
  durationMs: number;
  recipients: string[];
  note: string | null;
  shareLocation: boolean;
};

export async function armDeadman(args: ArmTimerArgs): Promise<void> {
  const { durationMs, recipients, note, shareLocation } = args;
  const totalSeconds = Math.max(60, Math.round(durationMs / 1000));
  const reminderSeconds = Math.max(30, totalSeconds - REMINDER_LEAD_MS / 1000);

  // Cancel any pre-existing scheduled timer notifications first so a
  // re-arm doesn't leave orphaned reminders in the tray.
  await disarmScheduledNotifications();

  let reminderId: string | null = null;
  let expiryId: string | null = null;
  try {
    reminderId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Deadman Timer ending soon',
        body: 'Tap to confirm safe, extend, or cancel. Otherwise your circle will be alerted.',
        data: { kind: 'deadman_reminder' },
      },
      trigger: { type: 'timeInterval', seconds: reminderSeconds, repeats: false } as never,
    });

    expiryId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Deadman Timer expired',
        body: "We've alerted your trusted circle and shared your last known location.",
        data: { kind: 'deadman_expired' },
      },
      trigger: { type: 'timeInterval', seconds: totalSeconds, repeats: false } as never,
    });
  } catch (err) {
    reportError(err, {
      category: 'deadman.schedule',
      message: 'Could not schedule deadman notifications',
    });
  }

  store.dispatch(
    deadmanArmed({
      durationMs,
      recipients,
      note,
      shareLocation,
      reminderNotificationId: reminderId,
      expiryNotificationId: expiryId,
    }),
  );

  addBreadcrumb({
    category: 'deadman',
    severity: 'info',
    message: `armed for ${Math.round(durationMs / 60000)} min`,
    data: { recipients: recipients.length, shareLocation },
  });
}

export async function extendDeadman(extraMs: number): Promise<void> {
  const state = store.getState().safetyModes.deadman;
  if (!state.active) return;

  // Cancel old notifications first.
  await disarmScheduledNotifications();

  const remainingMs =
    (state.expiresAt ?? Date.now()) - Date.now() + extraMs;
  if (remainingMs <= 0) return;

  // Re-arm with the remaining + extra. Cleaner than trying to delta-shift
  // the existing AlarmManager triggers, which expo-notifications doesn't
  // support directly.
  store.dispatch(deadmanExtended(extraMs));

  const totalSeconds = Math.max(60, Math.round(remainingMs / 1000));
  const reminderSeconds = Math.max(30, totalSeconds - REMINDER_LEAD_MS / 1000);

  try {
    const reminderId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Deadman Timer ending soon',
        body: 'Tap to confirm safe, extend, or cancel.',
        data: { kind: 'deadman_reminder' },
      },
      trigger: { type: 'timeInterval', seconds: reminderSeconds, repeats: false } as never,
    });
    const expiryId = await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Deadman Timer expired',
        body: "We've alerted your trusted circle.",
        data: { kind: 'deadman_expired' },
      },
      trigger: { type: 'timeInterval', seconds: totalSeconds, repeats: false } as never,
    });

    store.dispatch(
      deadmanArmed({
        durationMs: remainingMs,
        recipients: state.recipients,
        note: state.note,
        shareLocation: state.shareLocation,
        reminderNotificationId: reminderId,
        expiryNotificationId: expiryId,
      }),
    );
  } catch (err) {
    reportError(err, {
      category: 'deadman.extend',
      message: 'Could not reschedule notifications after extend',
    });
  }
}

export async function disarmDeadman(): Promise<void> {
  await disarmScheduledNotifications();
  store.dispatch(deadmanDisarmed());
  addBreadcrumb({
    category: 'deadman',
    severity: 'info',
    message: 'disarmed by user',
  });
}

async function disarmScheduledNotifications(): Promise<void> {
  const state = store.getState().safetyModes.deadman;
  const ids = [state.reminderNotificationId, state.expiryNotificationId].filter(
    (id): id is string => !!id,
  );
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
      // ignore
    }
  }
}
