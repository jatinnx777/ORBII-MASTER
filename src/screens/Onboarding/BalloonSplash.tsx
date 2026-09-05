import React, { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { colors, fontFamilies } from '@/theme';

/**
 * The opening animation: she rises out of frame holding the ORBII balloons.
 *
 * WHY TWO LAYERS AND NOT THREE. The version this replaces animated the girl
 * and the balloons apart, dropping her 60% down the screen while they rose 80%
 * up. She is holding the strings. Over 2.2 seconds those strings would stretch
 * to roughly four times their drawn length and then simply snap, because they
 * are painted into both bitmaps and cannot lengthen.
 *
 * She and the balloons are one physical object, so they are one layer, and the
 * whole assembly rises and shrinks into the distance together. That is both the
 * correct physics and one fewer asset to cut.
 *
 * WHY CORE Animated AND NOT REANIMATED. react-native-reanimated is not
 * installed here and never has been; the whole app runs on core Animated with
 * useNativeDriver, which for transform and opacity is handed to the native
 * thread and is exactly as smooth. Adding Reanimated for one screen means a
 * native dependency, a Babel plugin, and a rebuild.
 *
 * Everything animated here is transform or opacity, so `useNativeDriver: true`
 * holds throughout and the JS thread is free the entire time. That matters more
 * than usual: this runs while the app is still booting.
 */

export type BalloonSplashProps = {
  onFinish: () => void;
};

/** How long the rise takes. Long enough to read, short enough not to be a toll. */
const RISE_MS = 2400;
/** The skip appears almost immediately. Nobody should ever be trapped in a splash. */
const SKIP_AFTER_MS = 500;

export function BalloonSplash({ onFinish }: BalloonSplashProps) {
  const { height } = useWindowDimensions();
  const rise = useRef(new Animated.Value(0)).current;
  const skipIn = useRef(new Animated.Value(0)).current;

  // Guards a double call. The animation callback and the skip button can both
  // reach onFinish, and calling it twice would push two screens.
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onFinish();
  };

  useEffect(() => {
    let cancelled = false;
    let anim: Animated.CompositeAnimation | null = null;

    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduced) => {
        if (cancelled) return;
        if (reduced) {
          // No rise at all. Someone who has asked the OS for less motion should
          // not be given a two and a half second flight, and a splash is the
          // most skippable thing in the app.
          finish();
          return;
        }
        anim = Animated.parallel([
          Animated.timing(rise, {
            toValue: 1,
            duration: RISE_MS,
            // Out-quad rather than linear: she leaves quickly and decelerates
            // into the distance, which reads as altitude rather than as a pan.
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(skipIn, {
            toValue: 1,
            duration: 260,
            delay: SKIP_AFTER_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        anim.start(({ finished }) => {
          if (finished && !cancelled) finish();
        });
      });

    return () => {
      cancelled = true;
      anim?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Up, away, and out. Opacity fades last so she does not vanish while still
  // large enough to notice going.
  const subject = {
    opacity: rise.interpolate({ inputRange: [0, 0.72, 1], outputRange: [1, 1, 0] }),
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.78] }) },
      { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [1, 0.22] }) },
    ],
  };

  // The sky drifts a fraction of the subject's distance. Parallax is what makes
  // the rise read as her moving rather than the camera tilting.
  const sky = {
    transform: [
      { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.06] }) },
      { scale: rise.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1.12] }) },
    ],
  };

  return (
    <View style={s.root}>
      <Animated.Image
        source={require('../../../assets/splash/sky.png')}
        style={[StyleSheet.absoluteFillObject, sky]}
        resizeMode="cover"
        // Decorative. A screen reader should announce the skip button and
        // nothing else.
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <Animated.Image
        source={require('../../../assets/splash/subject.png')}
        style={[s.subject, subject]}
        resizeMode="contain"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />

      <Animated.View style={[s.skipWrap, { opacity: skipIn }]}>
        <Pressable
          onPress={finish}
          hitSlop={16}
          accessibilityRole="button"
          accessibilityLabel="Skip the intro"
          style={s.skip}
        >
          <Text style={s.skipText}>skip</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  // Matches the sky at the top of the image, so the single frame between mount
  // and the bitmap decoding is the same colour rather than a white flash.
  root: { flex: 1, backgroundColor: '#1E74D8' },
  subject: { ...StyleSheet.absoluteFillObject },
  skipWrap: { position: 'absolute', top: 56, right: 20 },
  skip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(23,22,28,0.28)',
  },
  skipText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.cream,
  },
});

export default BalloonSplash;
