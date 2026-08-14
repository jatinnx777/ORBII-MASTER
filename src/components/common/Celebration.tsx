import React, { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';

// A lightweight confetti burst, built on RN Animated (no extra library). Pieces
// explode from a point, arc outward, fall under a little gravity, spin and fade.
//
// Deliberately reserved for POSITIVE, non-emergency "gift" moments (finishing
// setup, the voice demo hearing you, a milestone). It is NEVER shown for firing
// an SOS — celebrating an emergency would be wrong, and nudging people toward it
// is exactly the pattern regulators fined Robinhood for.

const COLORS = ['#8672CE', '#C3B4EC', '#FF8FA3', '#FFC46B', '#4FA383', '#FF5A5F'];

type Piece = {
  color: string;
  size: number;
  angle: number; // radians, direction of the burst
  dist: number; // how far it flies
  drop: number; // extra downward fall (gravity)
  spin: number; // total rotation, degrees
  delay: number;
  round: boolean;
};

export function Celebration({
  visible,
  originY = 0.4,
  count = 26,
  onDone,
}: {
  visible: boolean;
  /** Vertical origin as a fraction of the container height (0 = top). */
  originY?: number;
  count?: number;
  onDone?: () => void;
}) {
  const t = useRef(new Animated.Value(0)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => (reduceMotion.current = v))
      .catch(() => undefined);
  }, []);

  // Deterministic per-mount piece layout, so a re-render never reshuffles.
  const pieces = useMemo<Piece[]>(() => {
    const rnd = (i: number, s: number) => {
      const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
      return x - Math.floor(x); // 0..1
    };
    return Array.from({ length: count }, (_, i) => ({
      color: COLORS[i % COLORS.length],
      size: 7 + Math.round(rnd(i, 1) * 7),
      angle: -Math.PI / 2 + (rnd(i, 2) - 0.5) * Math.PI * 1.35,
      dist: 120 + rnd(i, 3) * 190,
      drop: 220 + rnd(i, 4) * 260,
      spin: (rnd(i, 5) - 0.5) * 900,
      delay: rnd(i, 6) * 120,
      round: rnd(i, 7) > 0.5,
    }));
  }, [count]);

  useEffect(() => {
    if (!visible) return;
    t.setValue(0);
    if (reduceMotion.current) {
      onDone?.();
      return;
    }
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: 1600,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => finished && onDone?.());
    return () => anim.stop();
  }, [visible, t, onDone]);

  if (!visible || reduceMotion.current) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[styles.origin, { top: `${originY * 100}%` }]}>
        {pieces.map((p, i) => {
          const progress = t.interpolate({
            inputRange: [0, p.delay / 1600, 1],
            outputRange: [0, 0, 1],
            extrapolate: 'clamp',
          });
          const translateX = progress.interpolate({
            inputRange: [0, 1],
            outputRange: [0, Math.cos(p.angle) * p.dist],
          });
          const translateY = progress.interpolate({
            inputRange: [0, 0.45, 1],
            outputRange: [0, Math.sin(p.angle) * p.dist, Math.sin(p.angle) * p.dist + p.drop],
          });
          const rotate = progress.interpolate({
            inputRange: [0, 1],
            outputRange: ['0deg', `${p.spin}deg`],
          });
          const opacity = t.interpolate({
            inputRange: [0, 0.75, 1],
            outputRange: [1, 1, 0],
            extrapolate: 'clamp',
          });
          const scale = progress.interpolate({
            inputRange: [0, 0.15, 1],
            outputRange: [0.2, 1, 0.9],
          });
          return (
            <Animated.View
              key={i}
              style={{
                position: 'absolute',
                width: p.size,
                height: p.round ? p.size : p.size * 0.55,
                borderRadius: p.round ? p.size / 2 : 2,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateX }, { translateY }, { rotate }, { scale }],
              }}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  origin: {
    position: 'absolute',
    left: '50%',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
