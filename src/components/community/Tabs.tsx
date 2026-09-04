import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies } from '@/theme';

/**
 * The tab strip under a profile, with the indicator that slides.
 *
 * WHAT ANIMATES AND WHAT DOES NOT, because this is the one place the rule gets
 * broken by default. The INDICATOR moves, because its purpose is state
 * indication: it answers "which tab am I on" in a way a colour change alone
 * does not. The CONTENT never slides. Sliding panels imply the tabs are places
 * side by side in space, they are peers over the same profile, and the user
 * would pay for that animation every time they switched.
 *
 * The indicator uses translateX and scaleX on the native driver, so switching
 * tabs stays smooth while the list underneath is fetching and re-rendering.
 * Animating `left` and `width` instead would run a layout pass per frame, in a
 * row that sits above a list, which is exactly where it would be felt.
 */

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export type Tab = { key: string; label: string };

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Tab[];
  active: string;
  onChange: (key: string) => void;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
  }, []);

  // Measured rather than assumed, because label widths differ and text scales
  // with the system font size. A hardcoded width is wrong at 200 percent type.
  const [widths, setWidths] = useState<number[]>(() => tabs.map(() => 0));
  const [xs, setXs] = useState<number[]>(() => tabs.map(() => 0));

  const onTabLayout = (i: number) => (e: LayoutChangeEvent) => {
    const { width, x } = e.nativeEvent.layout;
    setWidths((prev) => (prev[i] === width ? prev : prev.map((w, j) => (j === i ? width : w))));
    setXs((prev) => (prev[i] === x ? prev : prev.map((v, j) => (j === i ? x : v))));
  };

  const index = Math.max(0, tabs.findIndex((t) => t.key === active));
  const anim = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: index,
      duration: reduced ? 0 : 200,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [index, reduced, anim]);

  const ready = widths.every((w) => w > 0);
  // A single unit-width bar, moved and stretched. Both are transforms, so the
  // whole thing stays off the JS thread.
  const UNIT = 1;
  const translateX = ready
    ? anim.interpolate({
        inputRange: tabs.map((_, i) => i),
        outputRange: tabs.map((_, i) => xs[i] + widths[i] / 2 - UNIT / 2),
      })
    : 0;
  const scaleX = ready
    ? anim.interpolate({
        inputRange: tabs.map((_, i) => i),
        outputRange: tabs.map((_, i) => widths[i]),
      })
    : 0;

  return (
    <View style={s.wrap}>
      <View style={s.row}>
        {tabs.map((t, i) => {
          const on = t.key === active;
          return (
            <Pressable
              key={t.key}
              onLayout={onTabLayout(i)}
              onPress={() => {
                if (on) return;
                Haptics.selectionAsync().catch(() => undefined);
                onChange(t.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              style={s.tab}
            >
              <Text style={[s.label, on && s.labelOn]}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>

      {ready ? (
        <Animated.View
          pointerEvents="none"
          style={[s.indicator, { transform: [{ translateX }, { scaleX }] }]}
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.cream,
  },
  row: { flexDirection: 'row' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 14 },
  label: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textMuted,
  },
  labelOn: { color: colors.textPrimary },
  indicator: {
    position: 'absolute',
    left: 0,
    bottom: -1,
    width: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brandDeep,
  },
});
