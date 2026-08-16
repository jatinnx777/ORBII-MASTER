import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';

// Settings rows, grouped.
//
// Three parts that are meant to be used together:
//
//   <RowSection title="Privacy" />
//   <RowGroup>
//     <Row ... />
//     <Row ... last />
//   </RowGroup>
//
// Rows live inside a rounded block with generous space around it, so a long
// settings screen reads as a handful of scannable groups rather than one
// undifferentiated list. The icon is a stroked outline in the ink colour, and
// the label carries the row: no tinted chiclet competing for attention.

// Kept so existing callers still compile. Tint applies only when a caller asks
// for `badge`, or when the row is destructive.
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
  /** Opt back in to the tinted square, for lists where colour means something. */
  badge?: boolean;
  /** Last row in a group: no divider underneath. */
  last?: boolean;
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
  badge,
  last,
}: RowProps) {
  const t = destructive ? TINTS.coral : TINTS[tint];
  const ink = destructive ? colors.coralDeep : colors.textPrimary;

  const content = (
    <View style={styles.inner}>
      {icon ? (
        badge ? (
          <View style={[styles.badge, { backgroundColor: t.bg }]}>
            <Ionicons name={icon} size={17} color={iconColor ?? t.fg} />
          </View>
        ) : (
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={22} color={iconColor ?? ink} />
          </View>
        )
      ) : null}
      <View style={styles.labelWrap}>
        <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
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
        <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
      ) : null}
    </View>
  );

  const body = onPress ? (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.creamDeep }}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {content}
    </Pressable>
  ) : (
    <View style={styles.row}>{content}</View>
  );

  return (
    <View>
      {body}
      {last ? null : <View style={styles.divider} />}
    </View>
  );
}

/**
 * The rounded block that holds a run of rows. The final row's divider is
 * dropped automatically, so callers never have to remember `last` and a group
 * can never end on a stray hairline against its own rounded edge.
 */
export function RowGroup({ children, style }: { children: ReactNode; style?: object }) {
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <View style={[styles.group, style]}>
      {items.map((child, i) =>
        i === items.length - 1 && React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<RowProps>, { last: true })
          : child,
      )}
    </View>
  );
}

/** Quiet label above a group. */
export function RowSection({ title }: { title: string }) {
  return <Text style={styles.sectionText}>{title}</Text>;
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    marginHorizontal: spacing.md,
    marginBottom: spacing.lg,
    overflow: 'hidden',
    // Micro-shadow: enough to lift the block off the canvas, never enough to
    // read as a drop shadow.
    shadowColor: '#2B0B45',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },
  row: {
    minHeight: 62,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  pressed: { backgroundColor: colors.creamDeep, opacity: 0.95 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginLeft: spacing.md + 30 + spacing.md,
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconWrap: { width: 30, alignItems: 'center' },
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
    fontSize: 16,
    letterSpacing: -0.2,
    color: colors.textPrimary,
  },
  value: {
    ...typography.caption,
    fontSize: 12.5,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 17,
  },
  right: {},

  sectionText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.2,
    marginHorizontal: spacing.md + 6,
    marginBottom: spacing.sm,
  },
});
