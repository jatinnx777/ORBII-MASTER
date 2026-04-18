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
import { colors, fontFamilies } from '@/theme';

type SOSButtonProps = {
  onPress: () => void;
  disabled?: boolean;
};

const SIZE = 220;

export function SOSButton({ onPress, disabled }: SOSButtonProps) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.03,
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

  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Send SOS alert"
        accessibilityHint="Starts a 3 second countdown, then sends your location to nearby helpers."
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.square,
          pressed && styles.pressed,
          disabled && styles.disabled,
        ]}
        hitSlop={16}
      >
        <View style={styles.asterisk}>
          <View style={[styles.bar, { transform: [{ rotate: '0deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '45deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '90deg' }] }]} />
          <View style={[styles.bar, { transform: [{ rotate: '135deg' }] }]} />
        </View>
        <Text style={styles.label}>SOS</Text>
      </Pressable>
    </Animated.View>
  );
}

const BAR_LEN = 70;
const BAR_THICK = 14;

const styles = StyleSheet.create({
  square: {
    width: SIZE,
    height: SIZE,
    borderRadius: 28,
    backgroundColor: '#F5A3A3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
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
    marginBottom: 8,
  },
  bar: {
    position: 'absolute',
    width: BAR_LEN,
    height: BAR_THICK,
    borderRadius: BAR_THICK / 2,
    backgroundColor: '#C25757',
  },
  label: {
    color: '#C25757',
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    letterSpacing: 2,
    marginTop: 4,
  },
});
