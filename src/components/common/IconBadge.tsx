import React from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, shadows } from '@/theme';

export type BadgeTint = 'gold' | 'sage' | 'coral' | 'lavender' | 'peach' | 'neutral';

const tintMap: Record<BadgeTint, { bg: string; fg: string }> = {
  gold: { bg: colors.goldSoft, fg: colors.goldDeep },
  sage: { bg: colors.sageSoft, fg: colors.sageDeep },
  coral: { bg: colors.coralSoft, fg: colors.coral },
  lavender: { bg: colors.lavenderSoft, fg: colors.lavenderDeep },
  peach: { bg: colors.peachSoft, fg: colors.peachDeep },
  neutral: { bg: colors.surface, fg: colors.textSecondary },
};

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  tint?: BadgeTint;
  /** Diameter of the badge. */
  size?: number;
  /** Soft floating shadow (used for the orbiting icons / chips). */
  floating?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The soft round icon badge that appears all over ORBII — feature chips,
 * orbiting hero icons, status rows, verified markers.
 */
export function IconBadge({
  icon,
  tint = 'neutral',
  size = 56,
  floating = false,
  style,
}: Props) {
  const { bg, fg } = tintMap[tint];
  return (
    <View
      style={[
        styles.badge,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        floating && shadows.icon,
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.46} color={fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
