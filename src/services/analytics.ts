import { supabase } from './supabase';

// Product analytics. This used to console.log in __DEV__ and do NOTHING in a
// release build, so every trackEvent call in the app, dozens of them, was
// silently discarded. Events now go to the `app_events` table (sql/35), which
// is insert-only: the app can never read the stream back.
//
// PRIVACY: `params` must never carry audio, transcripts, raw phone numbers or
// precise coordinates. Trigger metadata only.

type EventName =
  | 'app_opened'
  | 'onboarding_completed'
  | 'onboarding_voice_demo'
  | 'login_started'
  | 'login_completed'
  | 'sos_triggered'
  | 'sos_instant_long_press'
  | 'sos_from_fab'
  | 'sos_cancelled'
  | 'sos_resolved'
  | 'helper_accepted'
  | 'helper_arrived'
  | 'helper_mode_enabled'
  | 'helper_verified'
  | 'premium_viewed'
  | 'premium_purchased'
  | 'contact_added'
  | 'contact_removed'
  | 'voice_trigger_fired'
  // The two that matter most: cancelled ÷ (cancelled + confirmed) is the voice
  // engine's real false-positive rate.
  | 'voice_sos_cancelled'
  | 'voice_sos_confirmed'
  | 'voice_sos_enabled'
  | 'voice_phrase_rejected'
  // Which unbuilt features people actually tap, tells us what to build next.
  | 'coming_soon_tapped'
  | 'location_shared'
  | 'route_fetched'
  | 'silent_sos_toggled'
  | 'safe_journey_started'
  | 'safe_journey_ended'
  | 'community_alerts_viewed'
  | 'community_responded'
  | 'helper_alert_accepted'
  | 'helper_alert_declined'
  | 'helper_alert_ignored'
  | 'sos_dialed_112'
  | 'setup_protection_activated'
  | 'setup_completed'
  | 'mesh_capability_probe'
  | 'offline_helper_accept'
  | 'screen_viewed';

// Fire-and-forget. Never throws, never blocks a caller, several of these sit
// on the SOS path where an analytics hiccup must not cost a rescue.
async function send(name: EventName, params: Record<string, unknown>): Promise<void> {
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id ?? null;
    await supabase.from('app_events').insert({ user_id: uid, name, params });
  } catch {
    // Analytics is never worth surfacing or retrying.
  }
}

export function trackEvent(name: EventName, params: Record<string, unknown> = {}) {
  if (__DEV__) {
    console.log(`[analytics] ${name}`, params);
    return;
  }
  void send(name, params);
}

export function trackScreen(name: string) {
  if (__DEV__) {
    console.log(`[analytics] screen:${name}`);
    return;
  }
  void send('screen_viewed', { screen: name });
}
