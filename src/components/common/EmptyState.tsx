import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { Mascot } from './Mascot';

type EmptyStateProps = {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Show Orbi (with a small icon badge) instead of a plain icon circle. */
  mascot?: boolean;
};

// Warm, alive empty state: Orbi gently bobs in, one caring line, one clear
// button. Empty screens are where apps feel cheap; this is where ORBII feels
// cared-for.
export function EmptyState({
  icon = 'sparkles',
  title,
  body,
  actionLabel,
  onAction,
  mascot = true,
}: EmptyStateProps) {
  const enter = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, bob]);

  const translateY = Animated.add(
    enter.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }),
  );

  return (
    <View style={styles.wrap}>
      <Animated.View style={{ opacity: enter, transform: [{ translateY }], alignItems: 'center' }}>
        {mascot ? (
          <View style={styles.mascotWrap}>
            <Mascot size={128} />
            <View style={styles.iconBadge}>
              <Ionicons name={icon} size={18} color={colors.peachDeep} />
            </View>
          </View>
        ) : (
          <View style={styles.iconWrap}>
            <Ionicons name={icon} size={44} color={colors.peachDeep} />
          </View>
        )}
      </Animated.View>

      <Text style={styles.title}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}

      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.cta, pressed && { transform: [{ scale: 0.97 }], opacity: 0.95 }]}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  mascotWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  iconBadge: {
    position: 'absolute',
    bottom: 4,
    right: 8,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#B8895A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 3,
  },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    fontSize: 14.5,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 300,
    lineHeight: 21,
  },
  cta: {
    marginTop: spacing.md,
    backgroundColor: colors.peach,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    shadowColor: '#B8895A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  ctaText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
});
