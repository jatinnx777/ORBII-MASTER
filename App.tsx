// MUST be first: polyfills global crypto.getRandomValues so tweetnacl (used by
// the mesh sealed-box crypto) has a real RNG on React Native, on every instance.
import 'react-native-get-random-values';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, Linking, Platform, StyleSheet, Vibration, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
  DefaultTheme,
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { Provider } from 'react-redux';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
} from '@expo-google-fonts/inter';

import { store, useAppSelector } from '@/redux/store';
import { hydrateStore } from '@/redux/persist';
import { installGlobalErrorHandler } from '@/services/error-reporting';
import { supabase } from '@/services/supabase';
import { reconcileExpiredVoiceSessions } from '@/services/voice-sessions';
import {
  reportMeshCapabilitiesOnce,
  requestMeshPermissions,
  startMeshListening,
  disarmMesh,
} from '@/services/mesh';
import { subscribeHelperPings } from '@/services/mesh-helper-alert';
import { syncZoneMonitoring, authorizeGeofenceEvent, escalateGeofenceEvent, loadMyZones } from '@/services/geofence';
import * as Location from 'expo-location';
import { AuthNavigator } from '@/navigation/AuthNavigator';
import { AppNavigator } from '@/navigation/AppNavigator';
import { OnboardingScreen } from '@/screens/Onboarding/OnboardingScreen';
import { GuidedSetupScreen } from '@/screens/Setup/GuidedSetupScreen';
import { SafetyPinSetupScreen } from '@/screens/Setup/SafetyPinSetupScreen';
import { getItem, setItem, storageKeys } from '@/services/storage';
import {
  AppDialogHost,
  appAlert,
  BrandSheetProvider,
  OfflineBanner,
  PermissionDisclosureModal,
} from '@/components/common';
import { trackEvent } from '@/services/analytics';
import {
  hidePinnedSOSShortcut,
  hideSafeJourneyWidget,
  showPinnedSOSShortcut,
  showSafeJourneyWidget,
} from '@/services/notifications';
import {
  alertFromBroadcast,
  prewarmBroadcastChannel,
  subscribeToAlerts,
} from '@/services/community';
import { alertReceived, alertDismissed } from '@/redux/slices/communitySlice';
import { premiumTierResolved, signedOut } from '@/redux/slices/userSlice';
import { resolvePremiumTier } from '@/services/razorpay';
import { registerPushToken } from '@/services/push';
import { initSOSQueue } from '@/services/sos-queue';
import { flushPendingSosAudio } from '@/services/sos-audio';
// Side-effect import: registers the background victim-location task with the OS
// so a headless invocation (app killed mid-SOS) can still find it.
import { reconcileVictimLocationTask } from '@/services/sos-location-task';
import { refreshUserRole } from '@/services/roles';
import { startHelperMode, stopHelperMode } from '@/services/helper-mode';
import { voiceSOSStatus } from '@/services/voice-limits';
import { consumeVoiceTestFire } from '@/services/voice-test';
import { loadBgVoiceState, startBackgroundVoice } from '@/services/background-voice';
import { initI18n } from '@/i18n';
import {
  hydrateCirclesFromCache,
  refreshCircles,
  setActiveCircle,
} from '@/services/circles-bootstrap';
import { acceptInviteByToken } from '@/services/circles';
import { circlesReset } from '@/redux/slices/circlesSlice';
import { safeJourneyEnded, safeJourneyStarted } from '@/redux/slices/appSlice';
import { isPinSet, clearPin } from '@/services/safety-pin';
import { signOutFromGoogle } from '@/services/auth';
import { useDeviceEvictionGuard } from '@/services/session-guard';
import { hasSmsPermission, requestSmsPermission } from '@/services/sms';
import {
  showHelperOverlay,
  dismissHelperOverlay,
  formatOverlayDistance,
  hasOverlayPermission,
  requestOverlayPermission,
  overlayAvailable,
} from '@/services/helper-overlay';
import { colors } from '@/theme';

const navigationRef = createNavigationContainerRef();

// Offline helper-alert pings stream continuously; remember when each alert was
// last surfaced so we don't re-open the homing screen on every sighting.
const surfacedAlerts = new Map<string, number>();

// ORBII is a light-only app. Pin the navigator's background to cream so a
// half-faded screen never reveals anything darker behind it.
const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.cream },
};

SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore */
});

function RootNavigator() {
  const status = useAppSelector((s) => s.user.status);
  const uid = useAppSelector((s) => s.user.profile?.uid ?? null);
  const onboarded = useAppSelector((s) => s.app.onboarded);
  const hydrated = useAppSelector((s) => s.app.hydrated);

  // First-run guided setup (circle → secret phrase → protected). Shown once
  // after sign-in; null = still loading the flag from storage.
  const [setupDone, setSetupDone] = useState<boolean | null>(null);
  const [pinReady, setPinReady] = useState<boolean | null>(null);
  useEffect(() => {
    getItem<boolean>(storageKeys.guidedSetup).then((v) => setSetupDone(!!v));
    void isPinSet()
      .then(setPinReady)
      .catch(() => setPinReady(false));
  }, []);
  const helperMode = useAppSelector((s) => s.app.helperMode);

  // Show / hide the persistent lock-screen SOS shortcut as the user
  // signs in / out.
  useEffect(() => {
    if (status === 'authenticated') {
      showPinnedSOSShortcut().catch(() => undefined);
    } else {
      hidePinnedSOSShortcut().catch(() => undefined);
    }
  }, [status]);

  // Re-arm always-on background protection if the user left it on. The engine
  // listens for the built-in panic words ("help, help"), so no phrases to load.
  useEffect(() => {
    loadBgVoiceState().then((bg) => {
      if (bg.enabled) startBackgroundVoice([], bg.hours).catch(() => undefined);
    });
  }, []);

  // Helper Mode runtime: if the user opted in (and is signed in), start
  // advertising their location to helpers_live; otherwise make sure we're
  // marked offline. Survives cold start via the persisted helperMode flag.
  useEffect(() => {
    if (status === 'authenticated' && helperMode) {
      void startHelperMode();
      return () => {
        void stopHelperMode();
      };
    }
    void stopHelperMode();
  }, [status, helperMode]);

  // One-time: offer to let ORBII text emergency contacts automatically when
  // there's no internet. Granting SEND_SMS ahead of time keeps the offline SOS
  // silent and hands-free instead of prompting mid-emergency.
  useEffect(() => {
    if (status !== 'authenticated' || Platform.OS !== 'android') return;
    if ((store.getState().user.profile?.emergencyContacts?.length ?? 0) === 0) return;
    let cancelled = false;
    (async () => {
      if (await hasSmsPermission()) return;
      const seen = await getItem<boolean>('orbii:sms-prompt-seen');
      if (cancelled || seen) return;
      await setItem('orbii:sms-prompt-seen', true);
      appAlert(
        'Send an SOS even with no internet',
        'Let ORBII text your emergency contacts your location automatically when your data is down, and relay your SOS phone-to-phone over Bluetooth. Both work with no data.\n\nAndroid will then ask to allow SMS, that is expected. ORBII only uses it to text the contacts you chose during an SOS. It never reads your messages.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Enable',
            onPress: () => {
              // Pre-grant both offline permissions here so neither ever pops up
              // in the middle of an emergency.
              void (async () => {
                await requestSmsPermission();
                await requestMeshPermissions();
                // Start relaying now that Bluetooth is granted.
                void startMeshListening();
              })();
            },
          },
        ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // One-time reliability nudge for the FENCED person: OS geofencing only fires
  // with "Allow all the time" location AND battery optimization off. Without it,
  // a zone set on this person silently never triggers when the app is closed.
  // Asked once, and only if someone actually added them to a zone.
  useEffect(() => {
    if (status !== 'authenticated' || Platform.OS !== 'android') return;
    const uid = store.getState().user.profile?.uid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      const zones = await loadMyZones(uid);
      if (cancelled || zones.length === 0) return;
      const bg = await Location.getBackgroundPermissionsAsync();
      if (cancelled || bg.granted) return;
      const seen = await getItem<boolean>('orbii:geofence-bg-seen');
      if (seen) return;
      await setItem('orbii:geofence-bg-seen', true);
      appAlert(
        'Turn on background location for safe zones',
        'Someone added you to a safe zone. For ORBII to alert your circle if you leave it, set location to "Allow all the time" and turn off battery optimization for ORBII. Otherwise it can\'t watch the zone when the app is closed.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Open settings', onPress: () => void Linking.openSettings().catch(() => undefined) },
        ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  // One-time nudge: a helper needs "display over other apps" so an SOS can pop
  // over whatever app they're using. Asked once, never nags again.
  useEffect(() => {
    if (status !== 'authenticated' || !helperMode || !overlayAvailable()) return;
    let cancelled = false;
    (async () => {
      const granted = await hasOverlayPermission();
      if (cancelled || granted) return;
      const seen = await getItem<boolean>('orbii:overlay-prompt-seen');
      if (seen) return;
      await setItem('orbii:overlay-prompt-seen', true);
      appAlert(
        'Let alerts reach you over any app',
        'So an SOS can pop over apps like Instagram and you never miss someone nearby who needs help, ORBII needs "display over other apps" permission.',
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Enable', onPress: () => { void requestOverlayPermission(); } },
        ],
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [status, helperMode]);

  // Circles bootstrap. Hydrate the cached active-circle id immediately so
  // the Home header doesn't flash a different value while the network
  // call is in flight, then refresh from Supabase. On sign-out we clear
  // the slice so a different user signing in doesn't see stale data.
  useEffect(() => {
    if (status === 'authenticated') {
      hydrateCirclesFromCache().then(() => refreshCircles());
    } else if (status === 'idle') {
      store.dispatch(circlesReset());
    }
  }, [status]);

  // Keep circle invites fresh so an Instagram-style "X invited you" alert
  // arrives without opening the Circles tab: re-check when the app returns to
  // the foreground and on a gentle 60s poll while it's open. refreshCircles
  // fires the device push for any invite it hasn't announced yet.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const poll = setInterval(() => {
      if (AppState.currentState === 'active') void refreshCircles();
    }, 60_000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void refreshCircles();
        // Also re-pull the role, so a responder approved while their app was open
        // gets the Missions tab on return without needing to sign out and back in.
        void refreshUserRole();
      }
    });
    return () => {
      clearInterval(poll);
      sub.remove();
    };
  }, [status]);

  // Reconcile ORBII Plus on every sign-in / launch: active if a paid
  // subscription (server, survives reinstall) or coupon redemption is within
  // its 1-month window; otherwise the subscription is dismissed.
  useEffect(() => {
    if (status !== 'authenticated') return;
    resolvePremiumTier()
      // null = we couldn't tell (offline, no session yet). Leave the tier alone
      // rather than silently taking premium away from someone who paid.
      .then((tier) => {
        if (tier) store.dispatch(premiumTierResolved(tier));
      })
      .catch(() => undefined);
  }, [status]);

  // Give Realtime the user's JWT so PRIVATE channels (the per-SOS live-location
  // streams, gated by Realtime Authorization in sql/39) can authorize. The
  // client sets this automatically on a fresh SIGNED_IN, but a session restored
  // from storage on a cold start may not fire that event — without this the
  // private subscribe is refused and live tracking silently dies. Belt and
  // suspenders: set it explicitly on every authenticated launch.
  useEffect(() => {
    if (status !== 'authenticated') return;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const token = data.session?.access_token;
        if (token) void supabase.realtime.setAuth(token);
      })
      .catch(() => undefined);
  }, [status]);

  // Register this device's push token so an SOS can reach the user's circle +
  // contacts when their app is closed (server-side fan-out via notify-sos).
  useEffect(() => {
    if (status !== 'authenticated') return;
    const uid = store.getState().user.profile?.uid;
    if (uid) void registerPushToken(uid);
  }, [status]);

  // Close out any Voice SOS audit row whose timer lapsed while the app was
  // closed, so the legal log reflects the natural expiry the service performed.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void reconcileExpiredVoiceSessions();
    // Pull the authoritative role on launch, so an approved responder / admin
    // sees their tabs without a fresh sign-in.
    void refreshUserRole();
    // Offline mesh Phase 0: report this phone's mesh-radio capabilities once,
    // so we learn the real fleet's readiness before building the mesh.
    void reportMeshCapabilitiesOnce();
    // Become a relay: listen for nearby offline SOS beacons and bridge them.
    // No-op until Bluetooth permission is granted. Full-stop on sign-out.
    void startMeshListening();
    // Offline helper alert: if a nearby phone with no internet broadcasts a
    // location-free "someone near me needs help" ping, surface the homing
    // screen. Pings stream continuously, so only surface each alert once per
    // couple of minutes.
    const unsubHelperPing = subscribeHelperPings((p) => {
      const now = Date.now();
      if (now - (surfacedAlerts.get(p.alertId) ?? 0) < 120000) return;
      surfacedAlerts.set(p.alertId, now);
      if (
        navigationRef.isReady() &&
        navigationRef.getCurrentRoute()?.name !== 'OfflineHelperAlert'
      ) {
        // @ts-expect-error OfflineHelperAlert lives in the AppStack only.
        navigationRef.navigate('OfflineHelperAlert', { alertId: p.alertId });
        if (AppState.currentState !== 'active') Vibration.vibrate([0, 400, 200, 400]);
      }
    });
    return () => {
      void disarmMesh();
      unsubHelperPing();
    };
  }, [status]);

  // Single active device. Claim this device when signed in and listen for
  // another device taking the account over; if that happens, sign out here and
  // tell the user. No push involved — the eviction is handled entirely in-app.
  const evictedRef = useRef(false);
  useEffect(() => {
    if (status === 'authenticated') evictedRef.current = false;
  }, [status]);
  const handleEvicted = useCallback(async () => {
    if (evictedRef.current) return;
    evictedRef.current = true;
    await signOutFromGoogle().catch(() => undefined);
    await clearPin().catch(() => undefined);
    store.dispatch(signedOut());
    appAlert(
      'Signed out on this device',
      'Your ORBII account was just opened on another device. For your safety, only one device can be signed in at a time.',
    );
  }, []);
  useDeviceEvictionGuard(status === 'authenticated', uid, handleEvicted);

  // Re-arm safe-zone monitoring. The OS holds the geofences, but it forgets
  // them on reinstall/update, so we re-register whatever zones are set on us
  // every authenticated launch.
  useEffect(() => {
    if (status !== 'authenticated') return;
    const uid = store.getState().user.profile?.uid;
    if (uid) void syncZoneMonitoring(uid);
  }, [status]);

  // Pull the authoritative role (user / responder / admin) so the Missions tab
  // appears the moment an admin approves a responder application.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void refreshUserRole();
  }, [status]);

  // Deliver any SOS that fired while offline, now and whenever the network
  // comes back.
  useEffect(() => {
    if (status !== 'authenticated') return;
    return initSOSQueue();
  }, [status]);

  // Retry any SOS audio evidence that couldn't upload during the emergency
  // itself (the network is exactly what fails when it matters).
  useEffect(() => {
    if (status !== 'authenticated') return;
    void flushPendingSosAudio();
    // If we were killed mid-SOS, the location task may still be registered with
    // no screen left to stop it. Don't leak a foreground service.
    void reconcileVictimLocationTask();
  }, [status]);

  // Deep-link join handler. Listens for orbii://join/<token> AND
  // https://orbii.app/join/<token> opens, calls acceptInviteByToken,
  // and routes to the Circle detail on success. We only honour links
  // once the user is authenticated — if they tap a join link while
  // signed out they're sent through Welcome first, and the link is
  // re-tried on the next mount via getInitialURL.
  useEffect(() => {
    if (status !== 'authenticated') return;

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      // "I'll help" tapped on the over-other-apps overlay: bring ORBII forward
      // and open the helper alert for that SOS.
      if (url.startsWith('orbii://helper-respond')) {
        const m = url.match(/[?&]alertId=([^&]+)/);
        const alertId = m ? decodeURIComponent(m[1]) : undefined;
        void dismissHelperOverlay();
        if (alertId && navigationRef.isReady()) {
          // @ts-expect-error HelperAlert lives in the AppStack only.
          navigationRef.navigate('HelperAlert', { alertId });
        }
        return;
      }
      // Voice trigger from the on-device VoiceGuard engine — open the real SOS
      // countdown screen (5s, cancellable) which then dispatches + shows the
      // live ActiveSOS map. VoiceGuardService launches us over the lock screen
      // so this works without unlocking.
      if (url.startsWith('orbii://voice-sos')) {
        // A Voice SOS self-test is running: the engine heard the panic word, so
        // resolve the test instead of dispatching a real alert. Nothing sent.
        if (consumeVoiceTestFire()) return;
        if (!navigationRef.isReady()) return;
        // Premium gate: hands-free Voice SOS is metered on the free tier
        // (2/month); Premium is unlimited. This NEVER blocks a real emergency
        // — the manual SOS button stays free and unlimited — it only gates the
        // voice convenience and nudges the upgrade.
        const isPremium = store.getState().user.profile?.isPremium ?? false;
        const quota = await voiceSOSStatus(isPremium);
        if (!quota.allowed) {
          appAlert(
            'Voice SOS limit reached',
            `You've used your ${quota.limit} free Voice SOS this month. You can still send an SOS anytime with the button — or upgrade for unlimited hands-free Voice SOS.`,
            [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Upgrade',
                onPress: () => {
                  // @ts-expect-error - PremiumUpgrade is in the AppStack only.
                  navigationRef.navigate('PremiumUpgrade');
                },
              },
            ],
          );
          return;
        }
        // Trigger metadata from VoiceGuardService: which phrase fired, and the
        // pre-roll clip captured BEFORE she spoke. Both optional — an older
        // service build sends a bare `orbii://voice-sos`.
        const q = (key: string): string | undefined => {
          const m = url.match(new RegExp(`[?&]${key}=([^&]+)`));
          return m ? decodeURIComponent(m[1]) : undefined;
        };
        const phrase = q('phrase');
        const preroll = q('preroll');
        // Quota is recorded by CountdownScreen only when the SOS actually
        // fires, so a cancelled countdown doesn't burn a free activation.
        // @ts-expect-error - SOSCountdown is in the AppStack only.
        navigationRef.navigate('SOSCountdown', { voice: true, phrase, preroll });
        return;
      }
      const token = extractJoinToken(url);
      if (!token) return;
      try {
        const { circleId } = await acceptInviteByToken(token);
        await refreshCircles();
        await setActiveCircle(circleId);
        if (navigationRef.isReady()) {
          // @ts-expect-error - CircleDetail is in the AppStack only.
          navigationRef.navigate('CircleDetail', { circleId });
        }
      } catch (err) {
        appAlert(
          'Could not join circle',
          err instanceof Error ? err.message : 'The invite link is no longer valid.',
        );
      }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const sub = Linking.addEventListener('url', (ev) => handleUrl(ev.url));
    return () => sub.remove();
  }, [status]);

  // Safe Journey lock-screen widget. While a Safe Journey is active we
  // post a persistent notification with the live ETA + an "I'm safe"
  // action button. Re-posting on a 1-minute interval keeps the "X min
  // remaining" string fresh without burning battery.
  const safeJourney = useAppSelector((s) => s.app.safeJourney);
  useEffect(() => {
    if (status !== 'authenticated' || !safeJourney) {
      hideSafeJourneyWidget().catch(() => undefined);
      return;
    }
    const post = () =>
      showSafeJourneyWidget({
        label: safeJourney.label,
        etaMs: safeJourney.etaMs,
      }).catch(() => undefined);
    post();
    const id = setInterval(post, 60_000);
    return () => clearInterval(id);
  }, [status, safeJourney]);

  if (!hydrated) return null;
  if (!onboarded) return <OnboardingScreen />;
  if (status === 'authenticated') {
    // The safety PIN is mandatory and write-once. Gate BEFORE guided setup so
    // it's part of registration — and so the existing users who never had one
    // are asked exactly once, on their next launch.
    if (pinReady === null) return null;
    if (!pinReady) return <SafetyPinSetupScreen onDone={() => setPinReady(true)} />;
    if (setupDone === null) return null;
    if (!setupDone) {
      return (
        <GuidedSetupScreen
          onDone={() => {
            void setItem(storageKeys.guidedSetup, true);
            setSetupDone(true);
          }}
        />
      );
    }
    return (
      <>
        <AppNavigator />
        {/* Play "prominent disclosure" — shown once before any permission ask. */}
        <PermissionDisclosureModal />
      </>
    );
  }
  return <AuthNavigator />;
}

export default function App() {
  const [hydrated, setHydrated] = useState(false);

  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
  });

  useEffect(() => {
    // Capture uncaught crashes into client_errors (with breadcrumbs) so beta
    // failures are visible instead of vanishing. Install before anything else.
    installGlobalErrorHandler();
    // Boot order: i18n first (so any error toast during hydrate is
    // already localised), then store, then warm up realtime.
    Promise.all([initI18n(), hydrateStore()])
      .catch((err) => console.warn('boot failed', err))
      .finally(() => {
        trackEvent('app_opened');
        setHydrated(true);
        prewarmBroadcastChannel();
      });
  }, []);

  const ready = (fontsLoaded || fontError) && hydrated;

  const onReady = useCallback(async () => {
    if (ready) {
      await SplashScreen.hideAsync().catch(() => {
        /* ignore */
      });
    }
  }, [ready]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  // Listen for taps on the persistent notification's action buttons. This
  // works whether the app is foregrounded, backgrounded, or cold-launched
  // from the notification — expo-notifications replays the response on next
  // mount in the cold-launch case.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      const actionId = res.actionIdentifier;
      const data = res.notification.request.content.data ?? {};
      if (data.kind === 'sos_shortcut') {
        if (actionId === 'send-sos' && navigationRef.isReady()) {
          // @ts-expect-error - SOSCountdown is in the AppStack only.
          navigationRef.navigate('SOSCountdown');
        }
        return;
      }
      // Server push (notify-sos) — a circle member / contact tapped the SOS
      // notification. Open the nearby-alerts list so they can respond.
      if (data.kind === 'sos_push' && navigationRef.isReady()) {
        // @ts-expect-error - CommunityAlerts is in the AppStack only.
        navigationRef.navigate('CommunityAlerts');
        return;
      }
      // A verified helper tapped an incoming-help request (premium victim
      // nearby). Same destination — the nearby-alerts list shows the live SOS
      // and lets them accept and navigate.
      if (data.kind === 'incoming_sos' && navigationRef.isReady()) {
        // @ts-expect-error - CommunityAlerts is in the AppStack only.
        navigationRef.navigate('CommunityAlerts');
        return;
      }
      // Safe zone crossed — open the zone list, which shows the history.
      if (data.kind === 'geofence' && navigationRef.isReady()) {
        // @ts-expect-error - Geofences is in the AppStack only.
        navigationRef.navigate('Geofences');
        return;
      }
      // "You left <zone>" prompt for the fenced person. Confirm it was
      // intentional (clears it, nobody alerted) or flag it (her circle is told).
      if (data.kind === 'geofence_leave') {
        const eventId = typeof data.eventId === 'string' ? data.eventId : null;
        const geofenceId = typeof data.geofenceId === 'string' ? data.geofenceId : undefined;
        if (eventId && actionId === 'gf-authorized') {
          void authorizeGeofenceEvent(eventId);
        } else if (eventId && actionId === 'gf-alert') {
          void escalateGeofenceEvent(eventId, geofenceId);
          if (navigationRef.isReady()) {
            // @ts-expect-error - Geofences is in the AppStack only.
            navigationRef.navigate('Geofences');
          }
        } else if (navigationRef.isReady()) {
          // Plain tap: open the zone list so she can resolve it there.
          // @ts-expect-error - Geofences is in the AppStack only.
          navigationRef.navigate('Geofences');
        }
        return;
      }
      if (data.kind === 'community_alert' && navigationRef.isReady()) {
        const alertId = typeof data.alertId === 'string' ? data.alertId : null;
        if (alertId) {
          // @ts-expect-error - HelperAlert is in the AppStack only.
          navigationRef.navigate('HelperAlert', { alertId });
        } else {
          // @ts-expect-error - CommunityAlerts is in the AppStack only.
          navigationRef.navigate('CommunityAlerts');
        }
        return;
      }
      // Circle invite — open the Notifications screen where the invite card
      // (accept / decline) lives.
      if (data.kind === 'circle_invite' && navigationRef.isReady()) {
        // @ts-expect-error - Notifications is in the AppStack only.
        navigationRef.navigate('Notifications');
        return;
      }
      if (data.kind === 'voice_trigger' && navigationRef.isReady()) {
        // Tapping the wake notification jumps straight into the countdown.
        // @ts-expect-error - SOSCountdown is in the AppStack only.
        navigationRef.navigate('SOSCountdown');
        return;
      }
      if (data.kind === 'safe_journey_widget') {
        const journey = store.getState().app.safeJourney;
        if (!journey) return;
        if (actionId === 'safe-arrived') {
          // PIN guard: if the user set a safety PIN, force them into the
          // app to verify it before ending the journey. Stops an attacker
          // with the phone from quietly dismissing the lock-screen widget
          // and bypassing the watch-over-me promise.
          isPinSet().then((guarded) => {
            if (guarded) {
              if (navigationRef.isReady()) {
                // @ts-expect-error - SafeJourneyActive is in the AppStack only.
                navigationRef.navigate('SafeJourneyActive', { requirePinToEnd: true });
              }
            } else {
              store.dispatch(safeJourneyEnded());
              hideSafeJourneyWidget().catch(() => undefined);
            }
          });
          return;
        }
        if (actionId === 'extend-eta') {
          // Push the ETA 15 minutes forward and refresh the widget so the
          // user gets the extra cushion without opening the app.
          const newEta = journey.etaMs + 15 * 60 * 1000;
          store.dispatch(
            safeJourneyStarted({
              label: journey.label,
              etaMs: newEta,
              trustedContactId: journey.trustedContactId,
              destination: journey.destination,
            }),
          );
          showSafeJourneyWidget({ label: journey.label, etaMs: newEta }).catch(
            () => undefined,
          );
          return;
        }
        // Bare tap with no action → open Active screen
        if (navigationRef.isReady()) {
          // @ts-expect-error - SafeJourneyActive is in the AppStack only.
          navigationRef.navigate('SafeJourneyActive');
        }
      }
    });
    return () => sub.remove();
  }, []);

  // Voice triggers are now handled entirely in the deep-link handler above
  // (the on-device VoiceGuard engine fires `orbii://voice-sos` directly), so
  // there's no JS keyword subscription to wire up here anymore.

  // Global SOS broadcast receiver. Early access: deliver every alert to nearby
  // ORBII users (density is low, so a distance ring would just hide alerts).
  // The pending/expand plumbing is kept but idle; it returns to a real ring
  // gate once there are enough users for that to matter.
  useEffect(() => {
    const seen = new Set<string>();
    const pending = new Map<
      string,
      { broadcast: ReturnType<typeof Object>; alert: ReturnType<typeof Object>; distance: number }
    >();

    // Show the alert where the helper will actually see it: the in-app
    // full-screen screen when ORBII is open, or the native overlay-over-other-
    // apps popup (with siren) when they're using another app.
    const presentAlert = (a: { id: string; victim: { name: string }; distanceMeters: number }) => {
      // Always route to the full-screen alert: it shows now when ORBII is open,
      // and is queued so it appears the moment they next open the app. When
      // they're in another app, ALSO try the over-apps overlay (a bonus, only if
      // the "display over other apps" permission has been granted).
      if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name !== 'HelperAlert') {
        // @ts-expect-error HelperAlert lives in the AppStack only.
        navigationRef.navigate('HelperAlert', { alertId: a.id });
      }
      if (AppState.currentState !== 'active') {
        void showHelperOverlay({
          alertId: a.id,
          name: a.victim.name,
          distance: formatOverlayDistance(a.distanceMeters),
        });
      }
    };

    const handleAlert = (broadcastPayload: Parameters<typeof alertFromBroadcast>[0]) => {
      const state = store.getState();
      const me = state.user.profile?.uid ?? null;
      const here = state.sos.currentLocation;
      const alert = alertFromBroadcast(broadcastPayload, here, me);
      if (!alert) return;
      if (seen.has(alert.id)) return;
      const isFriend =
        !!me &&
        Array.isArray(broadcastPayload.friendUids) &&
        broadcastPayload.friendUids.includes(me);
      // Premium gate: a free user's SOS (circleOnly) reaches ONLY their circle.
      if (broadcastPayload.circleOnly && !isFriend) return;
      // Early access / low density: deliver EVERY alert so nearby ORBII users
      // actually see it. The old distance ring (fire only within 500 m, drop
      // past 3 km) was silently swallowing alerts for anyone not a few metres
      // apart, which is why testers saw nothing. The ring gate comes back once
      // there are enough users that "everyone sees everything" gets noisy.
      seen.add(alert.id);
      store.dispatch(alertReceived(alert));
      if (state.app.alertVibration) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
        const pattern = isFriend
          ? [0, 800, 200, 800, 200, 800, 200, 800, 200, 800, 200, 800, 200, 800]
          : [0, 600, 200, 600, 200, 600, 200, 600, 200, 600, 200, 600];
        Vibration.vibrate(pattern);
      }
      presentAlert(alert);
    };

    const handleExpand = (sosId: string, radiusKm: number) => {
      const cached = pending.get(sosId);
      if (!cached) return;
      // Only reveal this helper if the expanded ring now reaches them.
      if (cached.distance >= 0 && cached.distance > radiusKm * 1000) return;
      pending.delete(sosId);
      seen.add(sosId);
      const state = store.getState();
      // We dispatch the cached alert as if it just arrived. Vibration
      // pattern is identical so the responder treats it the same way.
      store.dispatch(alertReceived(cached.alert as never));
      if (state.app.alertVibration) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
          () => undefined,
        );
        Vibration.vibrate([0, 600, 200, 600, 200, 600, 200, 600, 200, 600, 200, 600]);
      }
      presentAlert(cached.alert as { id: string; victim: { name: string }; distanceMeters: number });
    };

    const handleResolved = (sosId: string) => {
      // The victim cancelled or resolved — clear it everywhere so no helper
      // keeps seeing "someone needs help".
      seen.delete(sosId);
      pending.delete(sosId);
      store.dispatch(alertDismissed(sosId));
      // Tear down the over-other-apps overlay if it's showing this SOS.
      void dismissHelperOverlay();
      // If a helper is staring at the full-screen alert for this SOS, kick
      // them back to the app — the emergency is over.
      if (
        navigationRef.isReady() &&
        navigationRef.getCurrentRoute()?.name === 'HelperAlert' &&
        (navigationRef.getCurrentRoute()?.params as { alertId?: string } | undefined)
          ?.alertId === sosId
      ) {
        // @ts-expect-error - Tabs lives in the AppStack.
        navigationRef.navigate('Tabs');
      }
    };

    const sub = subscribeToAlerts({
      onAlert: handleAlert,
      onExpand: handleExpand,
      onResolved: handleResolved,
    });
    return () => sub.unsubscribe();
  }, []);

  const [showLaunch, setShowLaunch] = useState(true);

  if (!ready) {
    return null;
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <BrandSheetProvider>
          <View style={styles.root} onLayout={onReady}>
            <StatusBar style="dark" />
            <OfflineBanner />
            <NavigationContainer ref={navigationRef} theme={navTheme}>
              <RootNavigator />
            </NavigationContainer>
          </View>
          {showLaunch ? <LaunchOverlay onDone={() => setShowLaunch(false)} /> : null}
          <AppDialogHost />
        </BrandSheetProvider>
      </SafeAreaProvider>
    </Provider>
  );
}

// Full-screen branded launch screen (orbii wordmark + tagline). Shown briefly
// over the app on cold start, then fades out. The native splash uses the same
// orange so the hand-off is seamless.
function LaunchOverlay({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => onDone());
    }, 900);
    return () => clearTimeout(t);
  }, [opacity, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.launch, { opacity }]}
    >
      <Image source={require('./assets/splash.png')} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
    </Animated.View>
  );
}

// Parse the token from any of:
//   orbii://join/<token>
//   https://orbii.app/join/<token>
//   https://orbii.app/join?token=<token>
// Returns null when the URL is not a join link, so any other deep link
// (auth callback, etc.) falls through to its own handler.
function extractJoinToken(url: string): string | null {
  try {
    const match = url.match(/(?:orbii:\/\/|https?:\/\/[^/]+\/)join\/?\??([^?&/#]+)/i);
    if (match && match[1] && match[1] !== 'join') return match[1];
    const queryMatch = url.match(/[?&]token=([^&#]+)/);
    if (queryMatch) return queryMatch[1];
    return null;
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  launch: {
    backgroundColor: '#7B5FC7',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  launchLogo: { width: 132, height: 132 },
  launchGlow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  launchRing: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
});
