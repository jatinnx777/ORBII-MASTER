import React, { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { colors, fontFamilies, radius, shadows, spacing, touchTarget, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  sosDispatchFailed,
  sosDispatchStarted,
  sosDispatchSucceeded,
} from '@/redux/slices/sosSlice';
import { getSOSLocationFix, reverseGeocode } from '@/services/location';
import { createSOS } from '@/services/sos';
import { recordVoiceSOS } from '@/services/voice-limits';
import { broadcastSOSViaWhatsApp } from '@/services/whatsapp-sos';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';
import type { SOSLocation } from '@/types';

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
  // Voice-triggered: count against the monthly voice quota only when the SOS
  // actually fires (a cancelled countdown costs nothing).
  const isVoice = route.params?.voice === true;

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

  // Macro-animation: a ring that smoothly drains over the countdown + a soft
  // pulse on the number each second, so the wait feels alive, not static.
  const progress = useRef(new Animated.Value(1)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (isInstant) return;
    Animated.timing(progress, {
      toValue: 0,
      duration: COUNTDOWN_SECONDS * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [isInstant, progress]);
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.12, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(pulse, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  }, [seconds, pulse]);
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
      appAlert('Sign in required', 'Please sign in before sending SOS.');
      navigation.goBack();
      return;
    }
    setTriggering(true);
    dispatch(sosDispatchStarted());
    try {
      // Critical path: get a best-effort location fix WITHOUT ever failing the
      // SOS. getSOSLocationFix degrades to last-known / null and never throws
      // or hangs, so an SOS still fires with no GPS — the circle + contacts are
      // pushed regardless; only nearby strangers (who need coordinates) are
      // skipped when location is unavailable. Reverse geocoding stays off the
      // critical path.
      const { point } = await getSOSLocationFix();
      const location: SOSLocation = point
        ? { ...point, address: null }
        : { latitude: 0, longitude: 0, address: null };
      const record = await createSOS(
        profile,
        location,
        isTest ? 'test' : 'real',
      );
      trackEvent('sos_triggered', {
        sosId: record.id,
        contacts: profile.emergencyContacts.length,
        kind: isTest ? 'test' : 'real',
      });
      dispatch(sosDispatchSucceeded(record));
      if (isVoice && !isTest) void recordVoiceSOS();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      navigation.replace('ActiveSOS');
      // Fire-and-forget WhatsApp broadcast to every emergency contact.
      // Push + realtime channel still fire on the critical path; WhatsApp
      // is the high-deliverability secondary that catches contacts who
      // mute notifications or aren't running ORBII.
      if (!isTest && point) {
        broadcastSOSViaWhatsApp({
          user: profile,
          location: { ...point, address: null },
        }).catch(() => undefined);
        // Note: audio recording is driven by ActiveSOSScreen's hook so
        // it ties recorder lifecycle to the React tree. We just navigate
        // forward and let that screen mount the recorder.
      }
      // Fire-and-forget address fill so the incident detail later shows a
      // human-readable location. Doesn't block the dispatch path.
      if (!isTest && point) {
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
      appAlert('SOS failed', message, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    }
  };

  const accent = isTest ? colors.textSecondary : colors.coral;
  const accentDeep = isTest ? colors.textPrimary : colors.coralDeep;

  return (
    <View style={[styles.container, { backgroundColor: isTest ? colors.creamDeep : colors.coralSoft }]}>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <View style={[styles.badge, { backgroundColor: isTest ? colors.surface : '#fff' }]}>
            <View style={[styles.badgeDot, { backgroundColor: accent }]} />
            <Text style={[styles.badgeText, { color: accentDeep }]}>
              {isTest ? 'PRACTICE · NO ALERTS SENT' : 'EMERGENCY SOS'}
            </Text>
          </View>
        </View>

        {/* Clean white card carries the countdown — calm, but serious. */}
        <View style={styles.card}>
          <Text style={styles.heading}>
            {isTest ? 'Practice SOS in' : 'Sending your SOS in'}
          </Text>

          <Animated.Text
            style={[styles.number, { color: accent, transform: [{ scale: pulse }] }]}
          >
            {triggering ? '…' : Math.max(seconds, 0)}
          </Animated.Text>
          {!triggering ? <Text style={styles.unit}>seconds</Text> : null}

          {!isInstant && !triggering ? (
            <View style={styles.progressTrack}>
              <Animated.View
                style={[
                  styles.progressFill,
                  {
                    backgroundColor: accent,
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  },
                ]}
              />
            </View>
          ) : null}

          <Text style={styles.caption}>
            {triggering
              ? isTest
                ? 'Test SOS recorded. No real alerts were sent.'
                : 'Alerting your circle and nearby helpers now.'
              : 'We’ll alert your circle and nearby helpers.'}
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
          <Text style={styles.cancelText}>I’m safe, cancel</Text>
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  top: { paddingTop: spacing.lg, alignItems: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...shadows.icon,
  },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  badgeText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11.5,
    letterSpacing: 1.2,
  },
  card: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: 36,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  heading: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  number: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 132,
    lineHeight: 148,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  unit: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginTop: -8,
  },
  progressTrack: {
    height: 8,
    alignSelf: 'stretch',
    borderRadius: 4,
    backgroundColor: colors.creamDeep,
    marginTop: spacing.lg,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 4 },
  caption: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.md,
    maxWidth: 300,
  },
  cancel: {
    alignSelf: 'stretch',
    minHeight: touchTarget.comfortable + 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  cancelPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: colors.creamDeep,
  },
  cancelDisabled: { opacity: 0.5 },
  cancelText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
  },
});
