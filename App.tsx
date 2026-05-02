import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Vibration, View } from 'react-native';
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
import {
  startCrashDetection,
  stopCrashDetection,
  subscribeCrashEvents,
} from '@/services/crash-detection';
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
  const crashDetection = useAppSelector((s) => s.app.crashDetection);

  // Show / hide the persistent lock-screen SOS shortcut as the user
  // signs in / out.
  useEffect(() => {
    if (status === 'authenticated') {
      showPinnedSOSShortcut().catch(() => undefined);
    } else {
      hidePinnedSOSShortcut().catch(() => undefined);
    }
  }, [status]);

  // Always-on Voice SOS — when enabled, kick the listener and post a sticky
  // "listening" notification so Android keeps the process alive while the
  // app is backgrounded / the screen is off.
  useEffect(() => {
    if (status !== 'authenticated' || !backgroundVoice) {
      hideListeningBadge().catch(() => undefined);
      return;
    }
    let cancelled = false;
    (async () => {
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
      hideListeningBadge().catch(() => undefined);
      stopListening();
    };
  }, [status, backgroundVoice]);

  // Crash detection — runs whenever the user is signed in and the toggle
  // is on. A detected crash routes through the navigationRef into the
  // SOS countdown, so the user gets a 5-second cancel window before the
  // alert actually fires.
  useEffect(() => {
    if (status !== 'authenticated' || !crashDetection) return;
    let cancelled = false;
    (async () => {
      const result = await startCrashDetection();
      if (cancelled || !result.ok) return;
    })();
    const unsub = subscribeCrashEvents(() => {
      Vibration.vibrate([0, 400, 200, 400]);
      if (navigationRef.isReady()) {
        // @ts-expect-error - SOSCountdown is in the AppStack only.
        navigationRef.navigate('SOSCountdown');
      }
    });
    return () => {
      cancelled = true;
      unsub();
      stopCrashDetection();
    };
  }, [status, crashDetection]);

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
    hydrateStore()
      .catch((err) => console.warn('hydrate failed', err))
      .finally(() => {
        trackEvent('app_opened');
        setHydrated(true);
        // Open the realtime broadcast WebSocket immediately. The first SOS
        // a user ever sends pays the WS handshake cost (3–8s on a cold
        // mobile network) — pre-warming at launch eliminates that latency.
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

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
