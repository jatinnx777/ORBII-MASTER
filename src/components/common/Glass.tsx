import React, { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';

// The glass layer.
//
// Everything that floats over a live map uses these, so controls read as one
// coherent sheet of glass rather than a scattering of one-off styles. Three
// rules hold the look together:
//
//   1. Translucent fill, never opaque. The map has to stay legible underneath,
//      because on a safety screen the map IS the content.
//   2. A hairline top-light border. It is what makes a translucent panel look
//      like glass instead of like a low-opacity rectangle.
//   3. A micro-shadow, wide and very faint. Enough to lift the panel off the
//      map; never enough to read as a drop shadow.
//
// Android's BlurView is more expensive and less convincing than iOS's, so the
// fill is a touch more opaque there and falls back cleanly if blur is dropped.

const ANDROID = Platform.OS === 'android';

export function GlassPanel({
  children,
  style,
  intensity = 34,
  radius: r = radius.xl,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  radius?: number;
}) {
  return (
    <View style={[styles.shadow, { borderRadius: r }, style]}>
      <BlurView
        intensity={ANDROID ? Math.min(intensity, 26) : intensity}
        tint="light"
        style={[styles.blur, { borderRadius: r }]}
      >
        <View style={[styles.fill, { borderRadius: r }]}>{children}</View>
      </BlurView>
    </View>
  );
}

/** Round glass control, the floating map buttons. */
export function GlassButton({
  icon,
  onPress,
  label,
  size = 44,
  accessibilityLabel,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  label?: string;
  size?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label ?? icon}
      style={({ pressed }) => [pressed && styles.pressed]}
      hitSlop={6}
    >
      <GlassPanel radius={size / 2} style={{ width: label ? undefined : size, height: size }}>
        <View style={[styles.btnInner, label ? styles.btnWide : { width: size, height: size }]}>
          <Ionicons name={icon} size={19} color={colors.textPrimary} />
          {label ? <Text style={styles.btnLabel}>{label}</Text> : null}
        </View>
      </GlassPanel>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#2B0B45',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 4,
  },
  blur: { overflow: 'hidden' },
  fill: {
    // The translucent body plus the top-light hairline that sells the glass.
    backgroundColor: ANDROID ? 'rgba(255,255,255,0.74)' : 'rgba(255,255,255,0.58)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  btnInner: { alignItems: 'center', justifyContent: 'center', flexDirection: 'row' },
  btnWide: { paddingHorizontal: spacing.md, paddingVertical: 11, gap: 6 },
  btnLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13.5,
    color: colors.textPrimary,
  },
});
