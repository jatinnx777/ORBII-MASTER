import React from 'react';
import { StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass, radius, shadows } from '@/theme';

// Glassmorphism surface, a real frosted blur (expo-blur) under a translucent
// fill with a hairline highlight border. Use for overlays, hero panels, and
// premium cards that sit over colour/imagery.
export function GlassCard({
  children,
  style,
  intensity = 28,
  strong = false,
  radius: r = radius.xl,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  strong?: boolean;
  radius?: number;
}) {
  return (
    <View style={[styles.wrap, { borderRadius: r }, shadows.card, style]}>
      <BlurView
        intensity={intensity}
        tint="light"
        style={[StyleSheet.absoluteFill, { borderRadius: r }]}
      />
      <View
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: r,
            backgroundColor: strong ? glass.fillStrong : glass.fill,
          },
        ]}
      />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: glass.border,
  },
  content: {
    padding: 18,
  },
});
