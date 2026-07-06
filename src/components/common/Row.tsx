import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, spacing, typography } from '@/theme';

// Soft tinted icon badges (iOS Settings feel), warm palette only. No purples.
export type RowTint = 'peach' | 'sage' | 'coral' | 'gold' | 'neutral';
const TINTS: Record<RowTint, { bg: string; fg: string }> = {
  peach: { bg: colors.peachSoft, fg: colors.peachDeep },
  sage: { bg: colors.sageSoft, fg: colors.sageDeep },
  coral: { bg: colors.coralSoft, fg: colors.coralDeep },
  gold: { bg: colors.goldSoft, fg: colors.goldDeep },
  neutral: { bg: colors.creamDeep, fg: colors.textSecondary },
};

type RowProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  tint?: RowTint;
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
};

export function Row({
  icon,
  iconColor,
  tint = 'neutral',
  label,
  value,
  right,
  onPress,
  destructive,
}: RowProps) {
  const t = destructive ? TINTS.coral : TINTS[tint];
  const labelColor = destructive ? colors.coralDeep : colors.textPrimary;

  const content = (
    <View style={styles.inner}>
      {icon ? (
        <View style={[styles.badge, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={17} color={iconColor ?? t.fg} />
        </View>
      ) : null}
      <View style={styles.labelWrap}>
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text style={styles.value} numberOfLines={2}>
            {value}
          </Text>
        ) : null}
      </View>
      {right ? (
        <View style={styles.right}>{right}</View>
      ) : onPress ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      ) : null}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: colors.creamDeep }}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={styles.row}>{content}</View>;
}

const styles = StyleSheet.create({
  row: {
    minHeight: 60,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.creamDeep, opacity: 0.9 },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  badge: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelWrap: { flex: 1 },
  label: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  value: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 1,
    lineHeight: 16,
  },
  right: {},
});
