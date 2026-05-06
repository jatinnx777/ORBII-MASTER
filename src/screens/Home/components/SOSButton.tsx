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
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';

type SOSButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
};

const BAR_LEN = 22;
const BAR_THICK = 5;

// SOS card. Solid red, no gradient, no glow. Subtle idle pulse + scale
// press feedback (0.96, 120ms). Tap = countdown, long-press = instant.
export function SOSButton({ onPress, onLongPress, disabled }: SOSButtonProps) {
  const pulse = useRef(new Animated.Value(1)).current;
  const press = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.025,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const handlePressIn = () => {
    Animated.timing(press, {
      toValue: 0.96,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.timing(press, {
      toValue: 1,
      duration: 120,
      useNativeDriver: true,
    }).start();
  };

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
    <Animated.View
      style={[
        styles.wrap,
        { transform: [{ scale: Animated.multiply(pulse, press) }] },
      ]}
    >
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
        style={[styles.card, disabled && styles.disabled]}
        hitSlop={8}
      >
        <View style={styles.asterisk}>
          <View style={[styles.bar, { transform: [{ rotate: '0deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '90deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '135deg' }] }]} />
        </View>
        <View style={styles.textCol}>
          <Text style={styles.label}>SOS</Text>
          <Text style={styles.hint}>Tap or hold</Text>
        </View>
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
    minHeight: 84,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderRadius: 20,
    backgroundColor: colors.primary,
    // Soft red lift — premium glow without neon. The shadow colour is
    // the SOS red itself, very low opacity, so it reads as warmth.
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 8,
  },
  disabled: {
    opacity: 0.5,
  },
  asterisk: {
    width: BAR_LEN,
    height: BAR_LEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: {
    alignItems: 'flex-start',
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
    letterSpacing: 4,
  },
  hint: {
    color: 'rgba(255,255,255,0.88)',
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 11,
    letterSpacing: 0.4,
    marginTop: 2,
  },
});
