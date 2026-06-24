import { getItem, setItem, storageKeys } from '@/services/storage';
import { supabase } from '@/services/supabase';
import { getFastLocation } from '@/services/location';
import { createSOS } from '@/services/sos';
import { recordVoiceSOS } from '@/services/voice-limits';
import { addBreadcrumb } from '@/services/error-reporting';
import type { SOSLocation, SOSRecord, UserProfile } from '@/types';

// HeadlessJS task: dispatch a Voice SOS WITHOUT any UI.
//
// VoiceGuardService (native) owns the cancel countdown. When it expires it
// starts this task via HeadlessJsTaskService, so the actual alert goes out
// even when the phone is locked, the app is backgrounded, or the app was
// killed — none of which can run the React UI.
//
// It is deliberately self-contained: it reads the persisted profile + Supabase
// session straight from storage (no Redux store needed in a cold JS context),
// grabs a fast location fix, and calls the SAME `createSOS` the UI uses — so
// the realtime broadcast + DB write are identical to a manual SOS. It then
// writes an `activeSos` handoff so the app can show ActiveSOS (already sent,
// no re-dispatch) the next time it's opened or the notification is tapped.

export type ActiveSosHandoff = { record: SOSRecord; at: number };

export async function sosDispatchTask(): Promise<void> {
  try {
    const profile = await getItem<UserProfile>(storageKeys.profile);
    if (!profile) return;

    // Make sure the persisted Supabase session (SecureStore) is restored
    // before any authenticated write/broadcast in a cold JS context.
    try {
      await supabase.auth.getSession();
    } catch {
      // proceed — the realtime broadcast still reaches nearby/circle helpers
    }

    let location: SOSLocation;
    try {
      const point = await getFastLocation();
      location = { ...point, address: null };
    } catch {
      // No fix available — still fire so the user's circle (notified
      // regardless of distance) gets the alert.
      location = { latitude: 0, longitude: 0, accuracy: null, address: null };
    }

    addBreadcrumb({
      category: 'sos',
      severity: 'info',
      message: 'headless voice-SOS dispatch',
      data: { uid: profile.uid },
    });

    const record = await createSOS(profile, location, 'real');
    await setItem<ActiveSosHandoff>(storageKeys.activeSos, {
      record,
      at: Date.now(),
    });
    void recordVoiceSOS();
  } catch {
    // Best-effort; there is no UI to surface an error to in this context.
  }
}
