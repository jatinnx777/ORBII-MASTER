// MUST be first: polyfills global crypto.getRandomValues so tweetnacl (used by
// the mesh sealed-box crypto) has a real RNG on React Native, on every instance.
import 'react-native-get-random-values';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FirstRun } from '@/screens/Onboarding/FirstRun';
import { Animated, AppState, Linking, Platform, StyleSheet, Vibration, View } from 'react-native';
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
import { CoverageProvider } from '@/context/CoverageContext';
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
import { Caveat_600SemiBold } from '@expo-google-fonts/caveat';

import { BalloonSplash } from '@/screens/Onboarding/BalloonSplash';
import { store, useAppSelector } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { hydrateStore } from '@/redux/persist';
import { restoreVoiceState } from '@/services/voice-detection';
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
import { bindReferral } from '@/services/referral';
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
import { initSOSQueue, flushSOSQueue } from '@/services/sos-queue';
import { initVaultAutoFlush, vaultStatusLine } from '@/services/hotPotatoVault';
import {
  initVolumetricMonitor,
  ENABLE_IMPACT_DETECTION,
  SHADOW_MODE,
} from '@/services/volumetricShock';
import { flushPendingSosAudio } from '@/services/sos-audio';
// Side-effect import: registers the background victim-location task with the OS
// so a headless invocation (app killed mid-SOS) can still find it.
import { reconcileVictimLocationTask } from '@/services/sos-location-task';
import { refreshUserRole } from '@/services/roles';
import { startHelperMode, stopHelperMode } from '@/services/helper-mode';
import { voiceSOSStatus } from '@/services/voice-limits';
import { consumeVoiceTestFire } from '@/services/voice-test';
import {
  loadBgVoiceState,
  startBackgroundVoice,
  recoverVoiceGuardIfKilled,
} from '@/services/background-voice';
import { ensureCircleShareNotExpired } from '@/services/circle-location';
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
import {
  showHelperOverlay,
  dismissHelperOverlay,
  formatOverlayDistance,
  hasOverlayPermission,
  requestOverlayPermission,
  overlayAvailable,
  showEdgeGlow,
  dismissEdgeGlow,
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
  // In memory, not persisted. It should replay if she force quits during
  // setup and comes back, because at that point she has not seen the app yet.
  const [introSeen, setIntroSeen] = useState(false);
  // Shown once, ever. Null while we read it, so a returning user never sees a
  // flash of the language picker on top of their own app.
  // Read from the device, not asked for. A language screen before she knows
  // what the app does is a screen that buys nothing, and the phone already
  // knows the answer. Changeable in Settings.
  //
  // Intl ships with Hermes, so this costs no dependency. Wrapped because a
  // stripped locale build returns something unexpected rather than throwing
  // where you would expect it to.
  const lang = useMemo<'en' | 'hi'>(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('hi')
        ? 'hi'
        : 'en';
    } catch {
      return 'en';
    }
  }, []);

  useEffect(() => {
  }, []);

  const status = useAppSelector((s) => s.user.status);
  const uid = useAppSelector((s) => s.user.profile?.uid ?? null);
  const onboarded = useAppSelector((s) => s.app.onboarded);
  const hydrated = useAppSelector((s) => s.app.hydrated);

  // First-run guided setup (circle → secret phrase → protected). Shown once
  // after sign-in; null = still loading the flag from storage.
  const [pinReady, setPinReady] = useState<boolean | null>(null);
  useEffect(() => {
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
    // restoreVoiceState also marks the shared status, so the Home and Emergency
    // tiles show ARMED after a cold start and their tap reaches disarm. Starting
    // the guard without that left Voice SOS on with no way to switch it off.
    void restoreVoiceState();
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
      const seen = await getItem<boolean>('orbii:sms-prompt-seen');
      if (cancelled || seen) return;
      await setItem('orbii:sms-prompt-seen', true);
      appAlert(
        'Reach help even with no internet',
        "Turn on ORBII's offline relay so an SOS can hop phone-to-phone over Bluetooth to someone who has signal when your data is down. Everything passed between phones is sealed end to end, so a relaying phone can't read it.",
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Enable',
            onPress: () => {
              // Pre-grant Bluetooth now so it never pops up mid-emergency.
              void (async () => {
                await requestMeshPermissions();
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

  // Retry a campus referral that never bound.
  //
  // ProfileSetup fires bindReferral unawaited while the screen is being torn
  // down, because a marketing attribution must never sit between a woman and
  // the end of setup on a safety app. That is the right priority and it makes
  // the call the least reliable one in the app: nothing retries it, and the
  // failure is silent by design, so a lost bind is a lost bind forever.
  //
  // The typed code is written to storage as she types it, and bindReferral
  // clears that store on any conclusive answer from the server, including a
  // refusal. So this is self-terminating: it runs at most once per outcome,
  // and only ever while a code is still sitting there unresolved.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void bindReferral().catch(() => undefined);
  }, [status]);

  // ENTITLEMENT, READ BACK ON EVERY SIGN-IN. Without this, Plus lasted exactly
  // one session.
  //
  // bootstrapProfile builds the profile with isPremium hardcoded false, and
  // resolvePremiumTier was called from precisely one place: the checkout screen,
  // right after a coupon was redeemed. So redeeming worked, the entitlement was
  // written to the server correctly, premium turned on, and then the next launch
  // rebuilt the profile from scratch and it was gone.
  //
  // The coupon guard then made it permanent. One redemption per account forever
  // means the second attempt is refused as "already redeemed", so somebody who
  // redeemed correctly ends up locked out of the thing they hold, with the app
  // telling them they already have it. That is what it looks like from the
  // outside, and it is exactly what happened here.
  //
  // resolvePremiumTier returns null when the question could not be answered, and
  // null is not dispatched. Downgrading somebody because a read failed looks
  // identical to theft to the person who paid.
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    void resolvePremiumTier()
      .then((tier) => {
        if (alive && tier) store.dispatch(premiumTierResolved(tier));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [status, uid]);


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
        // If an aggressive OEM battery manager killed background Voice SOS while
        // we were away, re-arm it and let her know (self-healing watchdog).
        void recoverVoiceGuardIfKilled();
        // Backup for circle live-location auto-off: if its window elapsed while
        // we were away, stop sharing now.
        void ensureCircleShareNotExpired();
        // Belt-and-braces: NetInfo change events can be missed, so also try to
        // flush any offline-queued SOS whenever the app comes back to the front.
        void flushSOSQueue();
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

  // Impact detection. A hard impact followed by four seconds of stillness looks
  // like a fall down a stairwell or an assault that ends with her on the ground.
  //
  // IT OPENS THE COUNTDOWN, IT DOES NOT FIRE AN SOS. No accelerometer heuristic
  // is ever certain, and the countdown is the one check that cannot be wrong
  // because she answers it. Wiring this straight to createSOS would put
  // strangers at her door because she dropped a bag.
  //
  // Gated on authentication, unlike the vault: an SOS needs a profile, and there
  // is nothing useful to do with a detected fall before sign-in.
  //
  // SHADOW MODE, which is what it is actually doing today. The detector runs
  // against the real accelerometer and its route into the app is closed inside
  // initVolumetricMonitor, so onTrigger below is unreachable. Every decision it
  // reaches is logged instead. After a week there is a measured answer to "how
  // often would this have fired, and on what", and the thresholds stop being
  // borrowed from a paper.
  //
  // ARMING IS NOW A RUNTIME DECISION, not a build constant. It used to take a
  // release to switch this on, which meant nobody could try it on one handset
  // without arming it for everybody at once. It reads a per-device setting that
  // defaults OFF, so shadow logging continues for everyone else and the data
  // that would fix the thresholds keeps accruing either way.
  const [impactArmed, setImpactArmed] = useState(false);
  useEffect(() => {
    if (status !== 'authenticated') return;
    let alive = true;
    void getItem<boolean>(storageKeys.impactDetection).then((v) => {
      if (alive) setImpactArmed(v === true);
    });
    return () => { alive = false; };
  }, [status]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!ENABLE_IMPACT_DETECTION && !SHADOW_MODE && !impactArmed) return;

    const handle = initVolumetricMonitor(
      () => {
        // Already counting down, or already live. Re-entering would restart a
        // countdown she is in the middle of cancelling.
        const st = store.getState();
        if (st.sos.activeSOS) return;
        if (!navigationRef.isReady()) return;
        // Already counting down. Re-navigating would restart a countdown she may
        // be halfway through cancelling, which is the opposite of a safeguard.
        if (navigationRef.getCurrentRoute()?.name === 'SOSCountdown') return;
        // impact: true does two things. It words the countdown as a detected
        // impact rather than a pressed button, and it records trigger =
        // 'impact' on the SOS (sql/120) so her circle is told a SENSOR raised
        // this. That distinction changes what a reader should do: a person who
        // pressed a button can usually answer the phone, and someone whose
        // phone took a hard knock and then stopped moving may not be able to.
        // @ts-expect-error SOSCountdown lives in the AppStack only, same as the
        // OfflineHelperAlert navigate above.
        navigationRef.navigate('SOSCountdown', { impact: true });
      },
      {
        // Every rejection is logged, because the thresholds in volumetricShock
        // were reasoned from published ranges and not measured on the phones
        // this ships to. Without the rejections there is nothing to tune from.
        //
        // This used to be a console.log, which in a release build is nobody
        // reading anything. It goes to app_events now, where sql/112 can read
        // it back, because a measurement no one can retrieve is not a
        // measurement.
        armed: impactArmed,
        onEvent: (e) => {
          trackEvent('impact_shadow', {
            type: e.type,
            reason: 'reason' in e ? e.reason : null,
            magnitudeG:
              'magnitudeG' in e ? Math.round(e.magnitudeG * 100) / 100 : null,
            // Whether this observation came from a phone that would have acted
            // on it. Without the distinction the log mixes "would have fired"
            // with "did fire" and stops answering the question it exists for.
            shadow: !impactArmed,
          });
        },
      },
    );
    return () => handle.stop();
  }, [status]);

  // Store and forward for OTHER people's SOS packets this phone relayed but
  // could not upload. Without this the mesh drops them, and a relay that walks
  // into wifi four minutes later never knows it was carrying one.
  //
  // Deliberately NOT gated on `status`. A relay is carrying somebody else's
  // emergency, and holding it hostage to whether this user happens to be signed
  // in would lose it for a reason that has nothing to do with the person in
  // trouble. The bridge accepts the anon key.
  useEffect(() => {
    const stop = initVaultAutoFlush();
    void vaultStatusLine().then((line) => console.log(line));
    return stop;
  }, []);

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
        void dismissEdgeGlow();
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
  if (status === 'authenticated') {
    // The safety PIN is mandatory and write-once. Gate BEFORE guided setup so
    // it's part of registration — and so the existing users who never had one
    // are asked exactly once, on their next launch.
    // EXISTING USERS ONLY. First run now sets the PIN as its last step, so a
    // new account reaches here with pinReady already true. This branch is the
    // one-time ask for accounts created before the PIN existed.
    if (pinReady === null) return null;
    if (!pinReady) return <SafetyPinSetupScreen onDone={() => setPinReady(true)} />;
    return (
      <>
        <AppNavigator />
        {/* Play "prominent disclosure" — shown once before any permission ask. */}
        <PermissionDisclosureModal />
      </>
    );
  }
  // ONE FLOW, six steps, and the last one is true.
  //
  // What used to live here: a six-slide carousel, a language screen, a video
  // about what ORBII is, fourteen registration steps, a PIN, and a five-step
  // guided setup. Twenty-nine screens. Slide six of the carousel was titled
  // "Two things and you're set".
  //
  // Language is no longer a screen. It is read from the device and changeable
  // in Settings, because asking someone to pick a language before she knows
  // what the app does is a screen that buys nothing.
  if (!onboarded) {
    // The intro plays ONCE, and only ahead of a first run. Someone who has
    // already set ORBII up is opening it because something is happening, and a
    // two second animation between her and the app is the last thing she needs.
    //
    // The native splash is the animation's first frame, so the handover from
    // the OS splash to this screen has nothing to see.
    if (!introSeen) {
      return <BalloonSplash onFinish={() => setIntroSeen(true)} />;
    }
    return (
      <FirstRun
        lang={lang}
        onDone={() => {
          store.dispatch(onboardingCompleted());
        }}
      />
    );
  }
  // Been here before, just signed out. She gets a login screen, not six steps
  // of setting up things she already set up.
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
    Caveat_600SemiBold,
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
      // Reminder that a time-boxed Voice SOS session is about to end (plain tap
      // or the "Keep listening" action) — open the Voice SOS screen to re-arm.
      if (data.kind === 'voice_expiry' && navigationRef.isReady()) {
        // @ts-expect-error - VoicePhrases is in the AppStack only.
        navigationRef.navigate('VoicePhrases');
        return;
      }
      // "Your phone paused Voice SOS" — open the reliability guide with the OEM
      // steps that stop it happening again.
      if (data.kind === 'voice_oem_help' && navigationRef.isReady()) {
        // @ts-expect-error - VoiceReliability is in the AppStack only.
        navigationRef.navigate('VoiceReliability');
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

      // Surface it over whatever app they are in. The most common way a nearby
      // helper misses an SOS is simply not looking at the notification shade,
      // so the card demands a decision and the edge glow catches the eye of
      // someone mid-scroll. Both are no-ops without the overlay permission, and
      // both are best-effort: neither may delay or break the alert itself.
      void showHelperOverlay({
        alertId: alert.id,
        name: alert.victim.name || 'Someone nearby',
        distance: formatOverlayDistance(alert.distanceMeters),
      }).catch(() => undefined);
      void showEdgeGlow().catch(() => undefined);
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
      void dismissEdgeGlow();
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
          {/* Inside BrandSheetProvider: the coverage pill opens a brand sheet. */}
          <CoverageProvider>
          <View style={styles.root} onLayout={onReady}>
            <StatusBar style="dark" />
            <OfflineBanner />
            <NavigationContainer ref={navigationRef} theme={navTheme}>
              <RootNavigator />
            </NavigationContainer>
          </View>
          {showLaunch ? <LaunchOverlay onDone={() => setShowLaunch(false)} /> : null}
          <AppDialogHost />
          </CoverageProvider>
        </BrandSheetProvider>
      </SafeAreaProvider>
    </Provider>
  );
}

// Launch hand-off. A plain solid pane in the exact colour of the native splash,
// shown for a beat over the app on cold start, then faded out. NO logo — it just
// masks the first paint so the app doesn't flash in, then gets out of the way
// fast. Kept short so startup feels instant.
function LaunchOverlay({ onDone }: { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }).start(() => onDone());
    }, 400);
    return () => clearTimeout(t);
  }, [opacity, onDone]);
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, styles.launch, { opacity }]}
    />
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
    // Exact native-splash colour so the hand-off is a seamless single surface.
    backgroundColor: '#bc95ec',
    zIndex: 999,
  },
});
