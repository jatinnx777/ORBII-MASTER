import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
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
import { OfflineBanner } from '@/components/common';
import { trackEvent } from '@/services/analytics';
import {
  fireVoiceWakeNotification,
  hideListeningBadge,
  hidePinnedSOSShortcut,
  showListeningBadge,
  showPinnedSOSShortcut,
} from '@/services/notifications';
import { prewarmBroadcastChannel } from '@/services/community';
import {
  startListening,
  stopListening,
  subscribeKeyword,
} from '@/services/voice-detection';
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

  if (!ready) {
    return null;
  }

  return (
    <Provider store={store}>
      <SafeAreaProvider>
        <View style={styles.root} onLayout={onReady}>
          <StatusBar style="dark" />
          <OfflineBanner />
          <NavigationContainer ref={navigationRef}>
            <RootNavigator />
          </NavigationContainer>
        </View>
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
