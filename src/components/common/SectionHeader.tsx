import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, fontFamilies, spacing } from '@/theme';

export function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.text}>{title}</Text>;
}

// Sentence case, not tracked-out micro-caps. Every screen in the app leaned on
// 11-12px UPPERCASE with wide letter-spacing for section titles, which shouts
// at the reader and is genuinely harder to scan than the rows underneath it.
const styles = StyleSheet.create({
  text: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 0.1,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginHorizontal: spacing.md + 6,
    marginBottom: spacing.sm,
  },
});
