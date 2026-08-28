import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Hold to stay safe.
//
// She presses and holds for the length of a short walk: the car park, the gate,
// the last stretch to the hostel. While her thumb is down, nothing happens.
// Letting go raises the alarm.
//
// This is the opposite of every other trigger in ORBII, and that is the point.
// The deadman TIMER answers "wake me if I don't check in by 9:40". This answers
// "the next three minutes are the bad part", where the failure she is afraid of
// is being unable to act at all. If the phone is knocked out of her hand, the
// release IS the trigger.
//
// It deliberately does NOT fire the SOS itself. Release navigates to the same
// SOSCountdown every other path uses, so the ten second cancel window, the
// safety PIN, the dispatch and the evidence recording are the proven ones. A
// second SOS pipeline is a second thing that can be wrong on the night it
// matters.
//
// KEEP_AWAKE is not a nicety here. A screen that sleeps under a held thumb ends
// the gesture, and a safety mode that cancels itself is worse than no mode.
const KEEP_AWAKE_TAG = 'hold-safe';

export function HoldSafeScreen() {
  const navigation = useNavigation<Nav>();

  const [holding, setHolding] = useState(false);
  const [heldSeconds, setHeldSeconds] = useState(0);
  // Guards the release handler. Leaving the screen, or a re-render mid-gesture,
  // must not be able to raise a second alarm.
  const armedRef = useRef(false);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const stopTick = useCallback(() => {
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
  }, []);

  // Disarm on unmount. Without this, navigating away with a thumb down would
  // leave armedRef true and a stray release could fire an alarm from a screen
  // she has already left.
  useEffect(
    () => () => {
      armedRef.current = false;
      stopTick();
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    },
    [stopTick],
  );

  const onPressIn = useCallback(() => {
    armedRef.current = true;
    setHolding(true);
    setHeldSeconds(0);
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    stopTick();
    tick.current = setInterval(() => setHeldSeconds((s) => s + 1), 1000);
  }, [stopTick]);

  const onPressOut = useCallback(() => {
    // Only a release from an armed hold counts. A tap that never armed, or a
    // release after she has already been sent to the countdown, does nothing.
    if (!armedRef.current) return;
    armedRef.current = false;
    stopTick();
    setHolding(false);
    deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    navigation.navigate('SOSCountdown');
  }, [navigation, stopTick]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const mmss = `${String(Math.floor(heldSeconds / 60)).padStart(2, '0')}:${String(
    heldSeconds % 60,
  ).padStart(2, '0')}`;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.title}>Hold to stay safe</Text>
        <Text style={styles.sub}>
          {holding
            ? 'Keep your thumb down. Let go and ORBII raises the alarm.'
            : 'Press and hold for the walk. Letting go starts your SOS, with ten seconds to cancel.'}
        </Text>
      </View>

      <View style={styles.center}>
        <Animated.View style={[styles.ringOuter, holding && styles.ringOuterLive, { transform: [{ scale }] }]}>
          <Pressable
            style={[styles.ring, holding && styles.ringLive]}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            accessibilityRole="button"
            accessibilityLabel="Hold to stay safe. Releasing starts your SOS countdown."
          >
            <Ionicons
              name={holding ? 'shield-checkmark' : 'hand-left'}
              size={44}
              color={holding ? colors.textInverse : colors.textSecondary}
            />
            <Text style={[styles.ringLabel, holding && styles.ringLabelLive]}>
              {holding ? mmss : 'Hold'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <Ionicons name="information-circle-outline" size={15} color={colors.textSecondary} />
        <Text style={styles.footerText}>
          Nothing is sent while you are holding. If you let go by accident you
          still have ten seconds and your safety PIN to stop it.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { ...typography.h2, color: colors.textPrimary },
  sub: { ...typography.body, color: colors.textSecondary, marginTop: spacing.xs, lineHeight: 21 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringOuter: {
    borderRadius: radius.pill,
    padding: spacing.sm,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  ringOuterLive: { backgroundColor: colors.coralSoft },
  ring: {
    width: 208,
    height: 208,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
  },
  ringLive: { backgroundColor: colors.coralDeep, borderColor: colors.coralDeep },
  ringLabel: { ...typography.h2, color: colors.textPrimary, marginTop: spacing.xs },
  ringLabelLive: { color: colors.textInverse },
  footer: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  footerText: { ...typography.caption, flex: 1, color: colors.textSecondary, lineHeight: 17 },
});
