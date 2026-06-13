import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, radius, spacing, typography } from '@/theme';

type SOSButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
};

// Peach SOS card matching the reference: soft coral-washed card, "SOS"
// title, "Hold for 3 seconds", and a round HOLD button with a breathing
// ring. Tap = 5s countdown, long-press = fire instantly.
export function SOSButton({ onPress, onLongPress, disabled }: SOSButtonProps) {
  const ring = useRef(new Animated.Value(0)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(ring, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [ring]);

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

  const handlePressIn = () =>
    Animated.spring(press, { toValue: 0.94, useNativeDriver: true, speed: 40 }).start();
  const handlePressOut = () =>
    Animated.spring(press, { toValue: 1, useNativeDriver: true, speed: 40 }).start();

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    onPress();
  };
  const handleLongPress = () => {
    if (!onLongPress) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
      () => undefined,
    );
    onLongPress();
  };

  return (
    <View style={[styles.card, disabled && styles.disabled]}>
      <Text style={styles.title}>SOS</Text>
      <Text style={styles.hint}>Hold for 3 seconds</Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send SOS alert"
        accessibilityHint="Tap for a 5-second countdown. Press and hold to fire instantly."
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={700}
        disabled={disabled}
        style={styles.holdZone}
        hitSlop={8}
      >
        <Animated.View
          style={[
            styles.ring,
            { opacity: ringOpacity, transform: [{ scale: ringScale }] },
          ]}
        />
        <Animated.View style={[styles.hold, { transform: [{ scale: press }] }]}>
          <Text style={styles.holdText}>HOLD</Text>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: radius.xxl,
    backgroundColor: colors.coralSoft,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  title: {
    ...typography.h3,
    color: colors.coral,
    letterSpacing: 1,
  },
  hint: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
    marginBottom: spacing.md,
  },
  holdZone: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.coral,
  },
  hold: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.coral,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holdText: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 15,
    color: colors.coral,
    letterSpacing: 1,
  },
});
