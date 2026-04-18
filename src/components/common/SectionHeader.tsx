import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, fontFamilies, spacing } from '@/theme';

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.text}>{title}</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontFamily: fontFamilies.poppinsMedium,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.textMuted,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
});
