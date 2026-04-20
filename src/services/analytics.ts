type EventName =
  | 'app_opened'
  | 'onboarding_completed'
  | 'login_started'
  | 'login_completed'
  | 'sos_triggered'
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
  | 'route_fetched'
  | 'silent_sos_toggled'
  | 'safe_journey_started'
  | 'safe_journey_ended'
  | 'community_alerts_viewed'
  | 'community_responded';

export function trackEvent(name: EventName, params: Record<string, unknown> = {}) {
  if (__DEV__) {
    console.log(`[analytics] ${name}`, params);
  }
}

export function trackScreen(name: string) {
  if (__DEV__) {
    console.log(`[analytics] screen:${name}`);
  }
}
