import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Linking,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { safeJourneyEnded } from '@/redux/slices/appSlice';
import { getCurrentLocation } from '@/services/location';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function SafeJourneyActiveScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const journey = useAppSelector((s) => s.app.safeJourney);
  const profile = useAppSelector((s) => s.user.profile);

  const [now, setNow] = useState(Date.now());
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!journey) return;
    if (now < journey.etaMs) return;
    // ETA has passed and user did not mark safe: auto-fire SOS. We navigate
    // to Countdown for the standard 5s cancel window in case the user is
    // just a little late. (Countdown will fall back to the normal SOS flow.)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(
      () => undefined,
    );
    Alert.alert(
      'Journey overdue',
      "You haven't marked yourself safe. Starting SOS.",
      [
        {
          text: 'Continue',
          onPress: () => {
            dispatch(safeJourneyEnded());
            navigation.replace('SOSCountdown');
          },
        },
      ],
    );
  }, [journey, now, dispatch, navigation]);

  if (!journey) {
    return (
      <ScreenContainer>
        <Text style={styles.empty}>No active journey.</Text>
      </ScreenContainer>
    );
  }

  const remainingMs = Math.max(0, journey.etaMs - now);
  const totalMs = journey.etaMs - journey.startedAtMs;
  const progress = 1 - remainingMs / totalMs;
  const mins = Math.floor(remainingMs / 60_000);
  const secs = Math.floor((remainingMs % 60_000) / 1000);
  const overdue = remainingMs === 0;

  const contact = profile?.emergencyContacts.find(
    (c) => c.id === journey.trustedContactId,
  );

  const handleSafe = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
    dispatch(safeJourneyEnded());
    Alert.alert('Welcome back', "We're glad you're safe.", [
      { text: 'Done', onPress: () => navigation.goBack() },
    ]);
  };

  const handleShareLocation = async () => {
    try {
      const point = await getCurrentLocation();
      const mapsUrl = `https://maps.google.com/?q=${point.latitude},${point.longitude}`;
      const msg = `ORBII Safe Mode: I'm on a "${journey.label}" trip. Live location: ${mapsUrl}`;
      if (contact) {
        const sms =
          Platform.OS === 'ios'
            ? `sms:${contact.phone}&body=${encodeURIComponent(msg)}`
            : `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
        Linking.openURL(sms).catch(() => {
          Share.share({ message: msg });
        });
      } else {
        Share.share({ message: msg });
      }
    } catch (err) {
      Alert.alert(
        'Could not get location',
        err instanceof Error ? err.message : 'Unknown error',
      );
    }
  };

  const handleEnd = () => {
    Alert.alert(
      'End Safe Mode?',
      'Make sure you are actually safe before ending.',
      [
        { text: 'Keep active', style: 'cancel' },
        {
          text: "I'm safe",
          onPress: handleSafe,
        },
      ],
    );
  };

  return (
    <ScreenContainer padded>
      <View style={styles.topRow}>
        <Text style={styles.eyebrow}>SAFE MODE ACTIVE</Text>
        <View style={styles.liveRow}>
          <Animated.View
            style={[
              styles.liveDot,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 0.35],
                }),
              },
            ]}
          />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      <Text style={styles.label}>{journey.label}</Text>

      <View style={styles.timerCard}>
        <Text style={styles.timerLabel}>
          {overdue ? 'OVERDUE' : 'TIME TO SAFE ARRIVAL'}
        </Text>
        <Text style={[styles.timer, overdue && { color: colors.primary }]}>
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </Text>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              {
                width: `${Math.min(100, Math.max(0, progress * 100))}%`,
                backgroundColor: overdue ? colors.primary : colors.success,
              },
            ]}
          />
        </View>
        <Text style={styles.timerMeta}>
          Arrive by{' '}
          {new Date(journey.etaMs).toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </Text>
      </View>

      {contact ? (
        <View style={styles.contactCard}>
          <View style={styles.contactAvatar}>
            <Text style={styles.contactInitial}>
              {contact.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.contactRole}>TRUSTED CONTACT</Text>
            <Text style={styles.contactName}>{contact.name}</Text>
          </View>
          <Pressable
            style={styles.contactCallBtn}
            onPress={() =>
              Linking.openURL(`tel:${contact.phone}`).catch(() => undefined)
            }
            hitSlop={10}
          >
            <Ionicons name="call" size={18} color={colors.textInverse} />
          </Pressable>
        </View>
      ) : null}

      <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
        <Pressable style={styles.secondary} onPress={handleShareLocation}>
          <Ionicons name="location" size={18} color={colors.textPrimary} />
          <Text style={styles.secondaryText}>Share live location now</Text>
        </Pressable>
      </View>

      <View style={{ flex: 1 }} />

      <View style={{ gap: spacing.sm }}>
        <Button label="I'm safe, end Safe Mode" onPress={handleEnd} />
        <Text style={styles.footerHint}>
          If you don't end Safe Mode before the timer runs out, ORBII will
          auto-fire SOS and alert {contact?.name ?? 'your contacts'}.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 2,
    color: colors.success,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.circle,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  liveText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.success,
  },
  label: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    marginBottom: spacing.lg,
  },
  timerCard: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderRadius: radius.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  timerLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.textMuted,
  },
  timer: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 72,
    lineHeight: 80,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
  },
  progressTrack: {
    alignSelf: 'stretch',
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.border,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
  },
  timerMeta: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  contactCard: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contactAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#E3F2FD',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#1976D2',
  },
  contactInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: '#1976D2',
  },
  contactRole: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: colors.textMuted,
  },
  contactName: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 16,
    color: colors.textPrimary,
  },
  contactCallBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryText: {
    ...typography.button,
    color: colors.textPrimary,
    fontSize: 15,
  },
  footerHint: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
  },
});
