import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { colors, fontFamilies, radius, spacing, touchTarget, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  sosDispatchFailed,
  sosDispatchStarted,
  sosDispatchSucceeded,
} from '@/redux/slices/sosSlice';
import { getFastLocation, reverseGeocode } from '@/services/location';
import { createSOS } from '@/services/sos';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

const COUNTDOWN_SECONDS = 5;

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function CountdownScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<AppStackParamList, 'SOSCountdown'>>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  // Long-press path bypasses the countdown, used when the user is in
  // immediate danger and can't wait the 5 seconds.
  const isInstant = route.params?.instant === true;
  // Practice mode: the SOS is recorded in local history but no DB write,
  // no broadcast, no real helpers notified.
  const isTest = route.params?.test === true;

  // Deadline-based countdown. We compute remaining time off Date.now() each
  // tick rather than decrementing a counter — that way an incoming phone
  // call (which background-throttles JS timers) can't pause the SOS. When
  // the app comes back to foreground we recompute from the original deadline,
  // and if the deadline has already passed we fire immediately.
  const deadlineRef = useRef<number>(
    Date.now() + (isInstant ? 0 : COUNTDOWN_SECONDS * 1000),
  );
  const [seconds, setSeconds] = useState(isInstant ? 0 : COUNTDOWN_SECONDS);
  const [triggering, setTriggering] = useState(false);
  const cancelledRef = useRef(false);
  const triggeredRef = useRef(false);
  const lastBuzzedSecondRef = useRef<number>(COUNTDOWN_SECONDS);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (cancelledRef.current) return;
    const id = setInterval(() => {
      if (cancelledRef.current || triggeredRef.current) return;
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setSeconds(remaining);
      if (remaining > 0 && remaining < lastBuzzedSecondRef.current) {
        lastBuzzedSecondRef.current = remaining;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
          () => undefined,
        );
      }
      if (remaining <= 0) {
        triggeredRef.current = true;
        clearInterval(id);
        triggerSOS();
      }
    }, 200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the OS pauses our JS engine (incoming call, screen lock), we want to
  // re-sync as soon as we're foregrounded. The deadline is fixed, so we
  // either fire immediately or just resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || cancelledRef.current || triggeredRef.current) return;
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );
      setSeconds(remaining);
      if (remaining <= 0) {
        triggeredRef.current = true;
        triggerSOS();
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    cancelledRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
      () => undefined,
    );
    navigation.goBack();
  };

  const triggerSOS = async () => {
    if (!profile) {
      Alert.alert('Sign in required', 'Please sign in before sending SOS.');
      navigation.goBack();
      return;
    }
    setTriggering(true);
    dispatch(sosDispatchStarted());
    try {
      // Critical path: get a location fix in <500ms (cached or balanced) and
      // fire the broadcast IMMEDIATELY. Reverse geocoding the address used
      // to be ~1-2s of blocking work on the worst possible code path; we
      // now do it in the background and never wait for it.
      const point = await getFastLocation();
      const record = await createSOS(
        profile,
        { ...point, address: null },
        isTest ? 'test' : 'real',
      );
      trackEvent('sos_triggered', {
        sosId: record.id,
        contacts: profile.emergencyContacts.length,
        kind: isTest ? 'test' : 'real',
      });
      dispatch(sosDispatchSucceeded(record));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      navigation.replace('ActiveSOS');
      // Fire-and-forget address fill so the incident detail later shows a
      // human-readable location. Doesn't block the dispatch path.
      if (!isTest) {
        reverseGeocode(point)
          .then((address) => {
            if (address) {
              dispatch(
                sosDispatchSucceeded({
                  ...record,
                  location: { ...record.location, address },
                }),
              );
            }
          })
          .catch(() => undefined);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not send SOS.';
      dispatch(sosDispatchFailed(message));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
        () => undefined,
      );
      Alert.alert('SOS failed', message, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.content}>
        {isTest ? (
          <View style={styles.testBadge}>
            <Text style={styles.testBadgeText}>PRACTICE · NO ALERTS SENT</Text>
          </View>
        ) : null}
        <Text style={styles.heading}>
          {isTest ? 'Practice SOS in' : 'Sending SOS in'}
        </Text>
        <Text style={styles.number}>
          {triggering ? '…' : Math.max(seconds, 0)}
        </Text>
        <Text style={styles.caption}>
          {triggering
            ? isTest
              ? 'Test SOS recorded. No real alerts dispatched.'
              : 'Dispatching helpers and alerting police…'
            : 'Release to cancel accidental alerts.'}
        </Text>
      </View>

      <Pressable
        onPress={handleCancel}
        disabled={triggering}
        accessibilityRole="button"
        accessibilityLabel="Cancel SOS"
        style={({ pressed }) => [
          styles.cancel,
          pressed && styles.cancelPressed,
          triggering && styles.cancelDisabled,
        ]}
      >
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    justifyContent: 'space-between',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  heading: {
    ...typography.h3,
    color: colors.textInverse,
    opacity: 0.9,
    textAlign: 'center',
  },
  number: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 160,
    lineHeight: 180,
    color: colors.textInverse,
    textAlign: 'center',
  },
  caption: {
    ...typography.body,
    color: colors.textInverse,
    opacity: 0.85,
    textAlign: 'center',
    maxWidth: 300,
  },
  testBadge: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  testBadgeText: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textInverse,
    letterSpacing: 1.5,
    fontSize: 11,
  },
  cancel: {
    alignSelf: 'stretch',
    minHeight: touchTarget.comfortable,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  cancelPressed: {
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  cancelDisabled: {
    opacity: 0.5,
  },
  cancelText: {
    ...typography.button,
    fontSize: 20,
    color: colors.textInverse,
    letterSpacing: 1,
  },

  silentContainer: {
    flex: 1,
    backgroundColor: '#0E0E10',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
    justifyContent: 'space-between',
  },
  silentContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  silentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.circle,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: spacing.md,
  },
  silentBadgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.textInverse,
  },
  silentHeading: {
    ...typography.body,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
  },
  silentNumber: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 120,
    lineHeight: 140,
    color: colors.textInverse,
    textAlign: 'center',
    letterSpacing: -2,
  },
  silentCaption: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.5)',
    textAlign: 'center',
    maxWidth: 280,
  },
  silentCancel: {
    alignSelf: 'stretch',
    minHeight: touchTarget.comfortable,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
  },
  silentCancelText: {
    ...typography.button,
    fontSize: 16,
    color: colors.textInverse,
    letterSpacing: 0.5,
  },
});
