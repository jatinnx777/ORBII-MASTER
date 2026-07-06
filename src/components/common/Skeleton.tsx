import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, spacing } from '@/theme';

// A soft shimmering placeholder. Premium apps never show a spinning circle;
// they show the shape of what's coming. Pass width/height, or use SkeletonRow
// for a standard list-row placeholder.

export function Skeleton({
  width,
  height = 16,
  rounded = 8,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  rounded?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] });
  return (
    <Animated.View
      style={[
        { width: width ?? '100%', height, borderRadius: rounded, backgroundColor: colors.creamDeep, opacity },
        style,
      ]}
    />
  );
}

/** A standard list-row placeholder: round badge + two text lines. */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <Skeleton width={32} height={32} rounded={10} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width={'55%'} height={13} />
        <Skeleton width={'80%'} height={11} />
      </View>
    </View>
  );
}

/** N rows stacked, for a loading list. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    minHeight: 60,
  },
  list: { gap: spacing.sm, paddingHorizontal: spacing.lg },
});
