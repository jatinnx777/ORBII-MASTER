import React from 'react';
import { Pressable, StyleSheet, View, type ViewStyle, type StyleProp } from 'react-native';
import { colors, radius, shadows } from '@/theme';

// Neumorphic surface — a soft extruded card on the warm canvas. RN supports a
// single shadow per view, so we render the warm-grey drop shadow on the outer
// view and a white top/left highlight border to fake the second light source.
// Set `onPress` to get a tactile pressed (inset-ish) state.
export function NeuCard({
  children,
  style,
  onPress,
  radius: r = radius.xl,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  radius?: number;
}) {
  const inner = (pressed: boolean) => (
    <View
      style={[
        styles.base,
        { borderRadius: r },
        pressed ? shadows.neuPressed : shadows.neu,
        pressed && styles.pressed,
        style,
      ]}
    >
      {/* top highlight edge — the second (light) source */}
      <View
        pointerEvents="none"
        style={[styles.highlight, { borderRadius: r }]}
      />
      {children}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress}>
        {({ pressed }) => inner(pressed)}
      </Pressable>
    );
  }
  return inner(false);
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: colors.cream,
    padding: 18,
  },
  highlight: {
    ...StyleSheet.absoluteFillObject,
    borderTopWidth: 1.5,
    borderLeftWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  pressed: {
    transform: [{ scale: 0.985 }],
  },
});
