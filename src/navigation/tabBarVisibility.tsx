import React, { createContext, useContext, useRef } from 'react';
import { Animated } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

// Shared "how hidden is the floating tab bar" value: 0 = fully shown, 1 = hidden.
// The bar reads it; scrollable screens drive it via useTabBarScroll().
const Ctx = createContext<Animated.Value | null>(null);

export function TabBarVisibilityProvider({ children }: { children: React.ReactNode }) {
  const hidden = useRef(new Animated.Value(0)).current;
  return <Ctx.Provider value={hidden}>{children}</Ctx.Provider>;
}

export function useTabBarHiddenValue(): Animated.Value {
  const v = useContext(Ctx);
  // A stable fallback so the bar still renders if used outside the provider.
  const fallback = useRef(new Animated.Value(0)).current;
  return v ?? fallback;
}

// Attach the returned handler to a ScrollView / FlatList `onScroll`
// (with scrollEventThrottle={16}). Scrolling down retracts the bar; up springs
// it back; near the top it always shows.
export function useTabBarScroll() {
  const hidden = useContext(Ctx);
  const lastY = useRef(0);
  const target = useRef(0);

  const set = (v: 0 | 1) => {
    if (!hidden || target.current === v) return;
    target.current = v;
    Animated.spring(hidden, {
      toValue: v,
      useNativeDriver: true,
      damping: 18,
      stiffness: 200,
      mass: 0.6,
    }).start();
  };

  return (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastY.current;
    lastY.current = y;
    if (y <= 8) return set(0); // near the top: always visible
    if (dy > 8) set(1); // scrolling down: retract
    else if (dy < -8) set(0); // scrolling up: spring back
  };
}
