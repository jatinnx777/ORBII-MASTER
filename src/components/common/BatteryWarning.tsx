import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBatteryStatus } from '@/services/battery-aware';
import { colors, fontFamilies, radius, spacing } from '@/theme';

// Low-battery warning banner. Renders inline (callers decide where) and
// only paints when the phone is below 20% AND unplugged. Honest copy —
// we tell the user exactly what will go wrong (their SOS may not get
// through if the phone dies) rather than vague "low battery" noise.

export function BatteryWarning() {
  const { level, isCharging, isLow } = useBatteryStatus();
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, {
      toValue: isLow ? 1 : 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isLow, fade]);

  if (!isLow) return null;
  const pct = Math.max(1, Math.round(level * 100));

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          opacity: fade,
          transform: [
            {
              translateY: fade.interpolate({
                inputRange: [0, 1],
                outputRange: [-4, 0],
              }),
            },
          ],
        },
      ]}
    >
      <View style={styles.icon}>
        <Ionicons name="battery-dead" size={14} color={colors.primary} />
      </View>
      <Text style={styles.text} numberOfLines={2}>
        Battery at {pct}%
        {isCharging ? ' · charging' : ' · plug in to keep ORBII protecting you'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,77,77,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.25)',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  icon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(255,77,77,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.primary,
    letterSpacing: 0.1,
  },
});
