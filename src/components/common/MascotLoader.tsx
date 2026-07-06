import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/theme';
import { Mascot } from './Mascot';
import type { MascotPose } from './Mascot';

const MESSAGES = [
  'Getting ready to watch over you…',
  'Waking up your circle…',
  'Almost there, stay with me…',
  'Turning on your protection…',
];

type Props = {
  /** Fixed message. If omitted, a friendly set rotates. */
  message?: string;
  pose?: MascotPose;
  size?: number;
};

/** A warm loading state — the guardian gently bobs while things load. */
export function MascotLoader({ message, pose = 'neutral', size = 96 }: Props) {
  const bob = useRef(new Animated.Value(0)).current;
  const [i, setI] = useState(0);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob]);

  useEffect(() => {
    if (message) return;
    const id = setInterval(() => setI((p) => (p + 1) % MESSAGES.length), 1600);
    return () => clearInterval(id);
  }, [message]);

  const translateY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Mascot pose={pose} size={size} />
      </Animated.View>
      <Text style={styles.text}>{message ?? MESSAGES[i]}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  text: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
