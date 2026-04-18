import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { colors, fontFamilies, spacing, touchTarget, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  sosDispatchFailed,
  sosDispatchStarted,
  sosDispatchSucceeded,
} from '@/redux/slices/sosSlice';
import { getCurrentLocation, getSOSLocation } from '@/services/location';
import { createSOS } from '@/services/sos';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

const COUNTDOWN_SECONDS = 3;

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function CountdownScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);
  const [triggering, setTriggering] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
  }, []);

  useEffect(() => {
    if (cancelledRef.current) return;
    if (seconds <= 0) {
      triggerSOS();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(
      () => undefined,
    );
    const timer = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

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
      const point = await getCurrentLocation();
      const location = await getSOSLocation(point);
      const record = await createSOS(profile, location);
      trackEvent('sos_triggered', {
        sosId: record.id,
        contacts: profile.emergencyContacts.length,
      });
      dispatch(sosDispatchSucceeded(record));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      navigation.replace('ActiveSOS');
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
        <Text style={styles.heading}>Sending SOS in</Text>
        <Text style={styles.number}>
          {triggering ? '…' : Math.max(seconds, 0)}
        </Text>
        <Text style={styles.caption}>
          {triggering
            ? 'Dispatching helpers and alerting police…'
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
});
