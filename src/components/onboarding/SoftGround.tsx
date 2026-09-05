import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors } from '@/theme';

/**
 * The soft blurred ground the onboarding screens sit on.
 *
 * HOW IT IS MADE, and why it is not an image or a gradient library. A mesh
 * gradient is four or five large soft colour fields bleeding into each other.
 * Rendering that as a PNG means shipping a 1MB asset per variant and it bands
 * badly when stretched across a tall phone. A gradient package is a native
 * dependency and a rebuild.
 *
 * So: a handful of hugely oversized circles at low opacity, and one heavy
 * BlurView over the top of them. expo-blur is already a dependency (the map
 * uses it for the glass controls) and the blur is what turns five hard discs
 * into one continuous field. The circles are bigger than the screen on purpose;
 * a circle whose edge is visible reads as a shape, and a circle whose edge is
 * off-screen reads as light.
 *
 * WHY IT DRIFTS. Very slowly, over about forty seconds, on a loop. A completely
 * static background on a screen someone is typing into feels like a photograph
 * behind glass; a background that moves at a speed you cannot quite see makes
 * the page feel alive without ever competing with the field she is filling in.
 * It respects reduced-motion by simply not starting.
 *
 * The colours are ORBII's: cream ground, peach and lavender fields, one small
 * sage note. Not Corner's blue-green, and not Life360's purple. The structure
 * is borrowed; the identity is not.
 */

export function SoftGround({
  reduced,
  children,
}: {
  /** Skip the drift when the OS asks for reduced motion. */
  reduced?: boolean;
  children?: React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const drift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, {
          toValue: 1,
          duration: 20000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(drift, {
          toValue: 0,
          duration: 20000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [drift, reduced]);

  // Sized off the viewport so the composition holds on a small phone and a
  // tablet alike, rather than being tuned to one device and cropping oddly on
  // every other.
  const blobs = useMemo(() => {
    const S = Math.max(width, height);
    return [
      { color: colors.peachSoft, size: S * 1.05, top: -S * 0.34, left: -S * 0.28, dx: 26, dy: 18 },
      { color: '#E4DAF7', size: S * 0.95, top: height * 0.06, left: width * 0.34, dx: -22, dy: 24 },
      { color: colors.goldSoft, size: S * 0.8, top: height * 0.44, left: -S * 0.22, dx: 18, dy: -20 },
      { color: colors.sageSoft, size: S * 0.7, top: height * 0.62, left: width * 0.42, dx: -16, dy: -14 },
      { color: colors.creamDeep, size: S * 0.6, top: height * 0.28, left: width * 0.06, dx: 12, dy: 16 },
    ];
  }, [width, height]);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {blobs.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: b.top,
              left: b.left,
              width: b.size,
              height: b.size,
              borderRadius: b.size / 2,
              backgroundColor: b.color,
              // Low enough that five overlapping fields stay pale. The blur
              // below does the blending; opacity only stops it going muddy.
              opacity: 0.85,
              transform: [
                { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx] }) },
                { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, b.dy] }) },
              ],
            }}
          />
        ))}
        {/* The blur is the whole effect. Without it these are five discs. */}
        <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />
        {/* A last cream wash so text always has enough contrast, wherever the
            fields happen to have drifted to underneath it. */}
        <View style={[StyleSheet.absoluteFill, styles.wash]} />
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  wash: { backgroundColor: 'rgba(250,249,236,0.42)' },
});

export default SoftGround;
