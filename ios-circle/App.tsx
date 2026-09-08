import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { colors } from './src/theme';
import { supabase } from './src/services/supabase';
import { registerForPush } from './src/services/push';
import { getCircleAlerts, type CircleAlert } from './src/services/alerts';
import { SignInScreen } from './src/screens/SignInScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AlertScreen } from './src/screens/AlertScreen';

/**
 * ORBII Circle.
 *
 * For the people someone trusts, rather than for the person at risk. The main
 * ORBII app is where an alarm is raised. This is where it gets answered.
 *
 * Navigation is two screens and one piece of state on purpose. A stack
 * navigator would buy nothing here and would put a transition between a person
 * and the screen telling them somebody needs help.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState<CircleAlert | null>(null);

  useEffect(() => {
    let alive = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSignedIn(!!data.session);
      setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(!!session);
      if (session) void registerForPush();
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Tapping the notification lands on the alert it was about, not on a list
  // the reader then has to search. The push carries the SOS id, and the alert
  // itself is FETCHED rather than trusted from the payload, so a notification
  // sitting in the tray for an hour can never put stale coordinates on screen.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const raw = response.notification.request.content.data as Record<string, unknown>;
      const sosId = typeof raw?.sosId === 'string' ? raw.sosId : null;
      if (!sosId) return;
      void getCircleAlerts().then((rows) => {
        const match = rows.find((r) => r.sos_id === sosId);
        if (match) setOpen(match);
      });
    });
    return () => sub.remove();
  }, []);

  if (!ready) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.brandDeep} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {!signedIn ? (
        <SignInScreen
          onDone={() => {
            setSignedIn(true);
            void registerForPush();
          }}
        />
      ) : open ? (
        <AlertScreen alert={open} onBack={() => setOpen(null)} />
      ) : (
        <HomeScreen
          onOpenAlert={setOpen}
          onSignedOut={() => {
            setOpen(null);
            setSignedIn(false);
          }}
        />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
