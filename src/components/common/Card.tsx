import React, { ReactNode } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, shadows, spacing } from '@/theme';

type Tint = 'surface' | 'peach' | 'coral' | 'lavender' | 'sage' | 'gold' | 'cream';

const tintBg: Record<Tint, string> = {
  surface: colors.surface,
  peach: colors.peachSoft,
  coral: colors.coralSoft,
  lavender: colors.lavenderSoft,
  sage: colors.sageSoft,
  gold: colors.goldSoft,
  cream: colors.cream,
};

type CardProps = {
  children: ReactNode;
  /** Background tint. Defaults to the warm-white surface. */
  tint?: Tint;
  /** Drop the soft shadow (for tinted inset cards that sit on a surface). */
  flat?: boolean;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Card({
  children,
  tint = 'surface',
  flat = false,
  padded = true,
  style,
}: CardProps) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: tintBg[tint] },
        padded && styles.padded,
        !flat && shadows.card,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
  },
  padded: {
    padding: spacing.lg,
  },
});
