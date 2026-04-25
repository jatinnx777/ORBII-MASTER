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
import { colors, fontFamilies, radius, spacing } from '@/theme';

type SOSButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
};

const BAR_LEN = 26;
const BAR_THICK = 6;

// Compact SOS card. Sits in a row with the Voice SOS card on the home
// screen. The asterisk + pulsing background keep its emergency feel even at
// half-width. Tap = countdown, long-press = instant SOS.
export function SOSButton({ onPress, onLongPress, disabled }: SOSButtonProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.04,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

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
    <Animated.View style={[styles.wrap, { transform: [{ scale: pulse }] }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send SOS alert"
        accessibilityHint="Tap for a 5-second countdown. Press and hold to fire instantly."
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={700}
        disabled={disabled}
        style={({ pressed }) => [
          styles.card,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
        hitSlop={8}
      >
        <View style={styles.asterisk}>
          <View style={[styles.bar, { transform: [{ rotate: '0deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '90deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '135deg' }] }]} />
        </View>
        <Text style={styles.label}>SOS</Text>
        <Text style={styles.hint}>Tap or hold</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  card: {
    flex: 1,
    minHeight: 110,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: 4,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.5,
  },
  asterisk: {
    width: BAR_LEN,
    height: BAR_LEN,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  bar: {
    position: 'absolute',
    width: BAR_LEN,
    height: BAR_THICK,
    borderRadius: BAR_THICK / 2,
    backgroundColor: colors.textInverse,
  },
  label: {
    color: colors.textInverse,
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    letterSpacing: 3,
  },
  hint: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11,
    letterSpacing: 0.5,
  },
});
