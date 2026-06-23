import React, { useEffect, useRef } from 'react';
import { Animated, type ViewStyle, type StyleProp } from 'react-native';

// Spring-entrance wrapper — fades + lifts its child into place with a soft
// overshoot/settle. Stagger a list by passing increasing `delay`s so the
// screen "assembles" with momentum instead of appearing flat.
export function PopIn({
  children,
  delay = 0,
  offset = 18,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  offset?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.spring(v, {
      toValue: 1,
      delay,
      friction: 8,
      tension: 60,
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [v, delay]);

  const translateY = v.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] });
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
