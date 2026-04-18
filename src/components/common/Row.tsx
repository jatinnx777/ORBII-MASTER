import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '@/theme';

type RowProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  label: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
};

export function Row({
  icon,
  iconColor,
  label,
  value,
  right,
  onPress,
  destructive,
}: RowProps) {
  const labelColor = destructive ? colors.primary : colors.textPrimary;
  const content = (
    <View style={styles.inner}>
      {icon ? (
        <Ionicons
          name={icon}
          size={20}
          color={iconColor ?? (destructive ? colors.primary : colors.textSecondary)}
          style={styles.icon}
        />
      ) : null}
      <View style={styles.labelWrap}>
        <Text style={[styles.label, { color: labelColor }]} numberOfLines={1}>
          {label}
        </Text>
        {value ? (
          <Text style={styles.value} numberOfLines={1}>
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
        android_ripple={{ color: colors.surface }}
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
    minHeight: 56,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.surface },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 22,
    textAlign: 'center',
  },
  labelWrap: { flex: 1 },
  label: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  value: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  right: {},
});
