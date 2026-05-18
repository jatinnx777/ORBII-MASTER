import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, StyleSheet, Vibration, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as Notifications from 'expo-notifications';
import {
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
import { AuthNavigator } from '@/navigation/AuthNavigator';
import { AppNavigator } from '@/navigation/AppNavigator';
import { OnboardingScreen } from '@/screens/Onboarding/OnboardingScreen';
import { BrandSheetProvider, OfflineBanner } from '@/components/common';
import { trackEvent } from '@/services/analytics';
import {
  fireVoiceWakeNotification,
  hideListeningBadge,
  hidePinnedSOSShortcut,
  showListeningBadge,
  showPinnedSOSShortcut,
} from '@/services/notifications';
import {
  alertFromBroadcast,
  prewarmBroadcastChannel,
  subscribeToAlerts,
} from '@/services/community';
import { alertReceived } from '@/redux/slices/communitySlice';
import {
  startListening,
  stopListening,
  subscribeKeyword,
} from '@/services/voice-detection';
import { startHardwareSOS } from '@/services/hardware-sos';
import { startBackgroundVoice } from '@/services/wake-word';
import { getItem, storageKeys } from '@/services/storage';
import { initI18n } from '@/i18n';
import {
  hydrateCirclesFromCache,
  refreshCircles,
  setActiveCircle,
} from '@/services/circles-bootstrap';
import { acceptInviteByToken } from '@/services/circles';
import { circlesReset } from '@/redux/slices/circlesSlice';
import { colors } from '@/theme';

const navigationRef = createNavigationContainerRef();

SplashScreen.preventAutoHideAsync().catch(() => {
  /* ignore */
});

function RootNavigator() {
  const status = useAppSelector((s) => s.user.status);
  const onboarded = useAppSelector((s) => s.app.onboarded);
  const hydrated = useAppSelector((s) => s.app.hydrated);
  const backgroundVoice = useAppSelector((s) => s.app.backgroundVoice);
  const hardwareSOS = useAppSelector((s) => s.app.hardwareSOS);

  // Show / hide the persistent lock-screen SOS shortcut as the user
  // signs in / out.
  useEffect(() => {
    if (status === 'authenticated') {
      showPinnedSOSShortcut().catch(() => undefined);
    } else {
      hidePinnedSOSShortcut().catch(() => undefined);
    }
  }, [status]);

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
        Alert.alert(
          'Could not join circle',
          err instanceof Error ? err.message : 'The invite link is no longer valid.',
        );
      }
    };

    Linking.getInitialURL().then(handleUrl).catch(() => undefined);
    const sub = Linking.addEventListener('url', (ev) => handleUrl(ev.url));
    return () => sub.remove();
  }, [status]);

  // Always-on Voice SOS. Tries the native foreground microphone
  // service first — the provider resolves the access key from the
  // APK-bundled BuildConfig field, then any user-saved key. Falls
  // back to the legacy expo-speech-recognition foreground listener
  // only if the native path is unavailable (no key bundled AND none
  // saved by the user).
  useEffect(() => {
    if (status !== 'authenticated' || !backgroundVoice) {
      hideListeningBadge().catch(() => undefined);
      return;
    }
    let cancelled = false;
    let nativeHandle: { stop: () => Promise<void> } | null = null;
    (async () => {
      const keyword = await getItem<string>(storageKeys.voiceKeyword);
      if (cancelled) return;

      const handle = await startBackgroundVoice({
        keyword: (keyword as never) ?? 'JARVIS',
        onWake: () => {
          if (navigationRef.isReady()) {
            // @ts-expect-error - SOSCountdown is in the AppStack only.
            navigationRef.navigate('SOSCountdown');
          }
        },
      });
      if (cancelled) {
        await handle?.stop();
        return;
      }
      if (handle) {
        nativeHandle = handle;
        return; // success — native side owns its own notification
      }

      // Native couldn't start (no key resolved). Fall back to the
      // foreground-only legacy listener so the toggle still does
      // something useful while the app is open.
      const result = await startListening();
      if (cancelled) return;
      if (result.ok) {
        showListeningBadge().catch(() => undefined);
      } else {
        hideListeningBadge().catch(() => undefined);
      }
    })();
    return () => {
      cancelled = true;
      if (nativeHandle) {
        nativeHandle.stop().catch(() => undefined);
      } else {
        hideListeningBadge().catch(() => undefined);
        stopListening();
      }
    };
  }, [status, backgroundVoice]);

  // Hardware SOS — triple-press of any volume key when the toggle is
  // ON. Tries the native AccessibilityService path first (works
  // backgrounded, screen off, OEM-resistant); falls back to a JS
  // volume-listener that only works while the app is foregrounded.
  useEffect(() => {
    if (status !== 'authenticated' || !hardwareSOS) return;
    let handle: { stop: () => void } | null = null;
    let cancelled = false;
    (async () => {
      const h = await startHardwareSOS(() => {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Warning,
        ).catch(() => undefined);
        if (navigationRef.isReady()) {
          // @ts-expect-error - SOSCountdown is in the AppStack only.
          navigationRef.navigate('SOSCountdown');
        }
      });
      if (cancelled) {
        h.stop();
        return;
      }
      handle = h;
    })();
    return () => {
      cancelled = true;
      handle?.stop();
    };
  }, [status, hardwareSOS]);

  if (!hydrated) return null;
  if (!onboarded) return <OnboardingScreen />;
  return status === 'authenticated' ? <AppNavigator /> : <AuthNavigator />;
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
      if (data.kind === 'community_alert' && navigationRef.isReady()) {
        // @ts-expect-error - CommunityAlerts is in the AppStack only.
        navigationRef.navigate('CommunityAlerts');
        return;
      }
      if (data.kind === 'voice_trigger' && navigationRef.isReady()) {
        // Tapping the wake notification jumps straight into the countdown.
        // @ts-expect-error - SOSCountdown is in the AppStack only.
        navigationRef.navigate('SOSCountdown');
      }
    });
    return () => sub.remove();
  }, []);

  // Global voice trigger handler — fires whether the keyword is heard from
  // the foreground HomeScreen listener OR the always-on background listener.
  // The wake notification ensures the screen lights up and the SOS flow opens
  // even if the phone was locked.
  useEffect(() => {
    const unsub = subscribeKeyword((keyword) => {
      fireVoiceWakeNotification(keyword).catch(() => undefined);
      if (navigationRef.isReady()) {
        // @ts-expect-error - SOSCountdown is in the AppStack only.
        navigationRef.navigate('SOSCountdown');
      }
    });
    return unsub;
  }, []);

  // Global SOS broadcast receiver. Two-stage radius: alerts within 2 km of
  // the receiver fire immediately. Alerts 2-5 km away are cached pending
  // the sender's "expand-radius" pulse (sent if no responder accepts in
  // 60 s). Anything beyond 5 km is dropped silently — keeps a Bangalore
  // alert from buzzing phones in Mumbai.
  useEffect(() => {
    const seen = new Set<string>();
    const pending = new Map<string, { broadcast: ReturnType<typeof Object>; alert: ReturnType<typeof Object> }>();

    const handleAlert = (broadcastPayload: Parameters<typeof alertFromBroadcast>[0]) => {
      const state = store.getState();
      const me = state.user.profile?.uid ?? null;
      const here = state.sos.currentLocation;
      const alert = alertFromBroadcast(broadcastPayload, here, me);
      if (!alert) return;
      if (seen.has(alert.id)) return;
      const distance = alert.distanceMeters;
      const within2km = distance < 0 || distance <= 2000;
      const within5km = distance < 0 || distance <= 5000;
      // Friends in the victim's circle get the alert regardless of distance,
      // with a stronger vibration. The receiver still sees an accurate
      // distance/ETA in the alert card.
      const isFriend =
        !!me &&
        Array.isArray(broadcastPayload.friendUids) &&
        broadcastPayload.friendUids.includes(me);
      if (within2km || isFriend) {
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
        return;
      }
      if (within5km) {
        pending.set(alert.id, { broadcast: broadcastPayload, alert });
      }
      // else: silently drop, this user is too far to help
    };

    const handleExpand = (sosId: string) => {
      const cached = pending.get(sosId);
      if (!cached) return;
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
    };

    const sub = subscribeToAlerts({ onAlert: handleAlert, onExpand: handleExpand });
    return () => sub.unsubscribe();
  }, []);

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
            <NavigationContainer ref={navigationRef}>
              <RootNavigator />
            </NavigationContainer>
          </View>
        </BrandSheetProvider>
      </SafeAreaProvider>
    </Provider>
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
});
