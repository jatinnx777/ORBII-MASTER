import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';

type SOSButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
};

const BAR_LEN = 18;
const BAR_THICK = 4;

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
          styles.cardShell,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
        hitSlop={8}
      >
        <LinearGradient
          colors={['#E60000', '#B30000']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.card}
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
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  cardShell: {
    flex: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
    ...shadows.hero,
  },
  card: {
    flex: 1,
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 8,
  },
  pressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.94,
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
    fontSize: 18,
    letterSpacing: 3,
  },
  hint: {
    color: 'rgba(255,255,255,0.85)',
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 10,
    letterSpacing: 0.4,
  },
});
