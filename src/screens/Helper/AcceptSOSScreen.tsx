import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { jobStatusChanged } from '@/redux/slices/helperSlice';
import { trackEvent } from '@/services/analytics';
import { formatDistance, formatEta } from '@/utils/geo';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'AcceptSOS'>;

const WINDOW_SECONDS = 30;

export function AcceptSOSScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const job = useAppSelector((s) => s.helper.currentJob);
  const [seconds, setSeconds] = useState(WINDOW_SECONDS);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.08,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (seconds <= 0) {
      handleDecline(true);
      return;
    }
    const id = setTimeout(() => setSeconds((s) => s - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds]);

  if (!job) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>No incoming SOS</Text>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.link}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const handleAccept = () => {
    trackEvent('helper_accepted', { jobId: job.id });
    dispatch(jobStatusChanged('accepted'));
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
    navigation.replace('HelperNavigation');
  };

  const handleDecline = (expired = false) => {
    dispatch(jobStatusChanged('declined'));
    if (!expired) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    }
    navigation.goBack();
  };

  const handleCall = () => {
    Linking.openURL(`tel:${job.user.phone}`).catch(() => undefined);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.kicker}>SOS ALERT</Text>
      <Text style={styles.title}>Someone needs you</Text>

      <Animated.View
        style={[styles.avatar, { transform: [{ scale: pulse }] }]}
      >
        <Text style={styles.avatarInitial}>
          {job.user.name.charAt(0).toUpperCase()}
        </Text>
      </Animated.View>

      <Text style={styles.userName}>{job.user.name}</Text>
      <View style={styles.metaRow}>
        <Ionicons name="location" size={14} color={colors.textInverse} />
        <Text style={styles.meta}>
          {formatDistance(job.distanceMeters)} · {formatEta(job.etaSeconds)}
        </Text>
      </View>
      <Text style={styles.address}>{job.location.address ?? 'Nearby'}</Text>

      <View style={styles.reward}>
        <Ionicons name="cash" size={18} color={colors.accent} />
        <Text style={styles.rewardText}>₹{job.reward} reward on resolution</Text>
      </View>

      <View style={styles.timer}>
        <Text style={styles.timerText}>Accept in {seconds}s</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={handleCall}
          style={styles.callBtn}
          accessibilityRole="button"
          accessibilityLabel="Call user"
        >
          <Ionicons name="call" size={22} color={colors.textInverse} />
        </Pressable>
        <Pressable
          onPress={() => handleDecline()}
          style={styles.declineBtn}
          accessibilityRole="button"
          accessibilityLabel="Decline"
        >
          <Text style={styles.declineText}>Decline</Text>
        </Pressable>
        <Pressable
          onPress={handleAccept}
          style={styles.acceptBtn}
          accessibilityRole="button"
          accessibilityLabel="Accept SOS"
        >
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  kicker: {
    ...typography.caption,
    fontFamily: fontFamilies.poppinsBold,
    letterSpacing: 3,
    color: colors.textInverse,
    opacity: 0.85,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textInverse,
    marginBottom: spacing.lg,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 44,
    color: colors.primary,
  },
  userName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textInverse,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    ...typography.body,
    color: colors.textInverse,
  },
  address: {
    ...typography.caption,
    color: colors.textInverse,
    opacity: 0.85,
    textAlign: 'center',
    maxWidth: 280,
  },
  reward: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  rewardText: {
    ...typography.bodyMedium,
    color: colors.textInverse,
  },
  timer: {
    marginTop: spacing.md,
  },
  timerText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 18,
    color: colors.textInverse,
    letterSpacing: 1,
  },
  actions: {
    marginTop: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  callBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.textInverse,
  },
  declineText: {
    ...typography.button,
    color: colors.textInverse,
  },
  acceptBtn: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.textInverse,
  },
  acceptText: {
    ...typography.button,
    color: colors.primary,
  },
  link: {
    ...typography.bodyMedium,
    color: colors.textInverse,
    marginTop: spacing.md,
  },
});
