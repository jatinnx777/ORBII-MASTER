import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';
import { BadgeTint, IconBadge } from './IconBadge';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint?: BadgeTint;
  badgeSize?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Icon badge stacked over a short label — the four-feature row on the
 * splash / onboarding screens (AI-Powered Protection, Live Location, …).
 */
export function FeatureChip({ icon, label, tint = 'neutral', badgeSize = 48, style }: Props) {
  return (
    <View style={[styles.wrap, style]}>
      <IconBadge icon={icon} tint={tint} size={badgeSize} />
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    flex: 1,
    paddingHorizontal: spacing.xs,
  },
  label: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
