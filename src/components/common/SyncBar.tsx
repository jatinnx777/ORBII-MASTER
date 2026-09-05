import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from '@/theme/colors';

/**
 * A 2px line at the very top of the screen while a background refresh runs.
 *
 * WHY THIS EXISTS AT ALL. Once a screen hydrates from cache it never blanks
 * again, which is the point, but it also means a refresh becomes completely
 * invisible. On a safety app that is its own problem: a parent looking at a
 * roster needs some way to tell "this is the live answer" from "this is what
 * your phone remembered". The line is that signal and nothing more.
 *
 * WHY IT WAITS. Most refreshes finish in a few hundred milliseconds, and a bar
 * that appears and vanishes that fast reads as a glitch rather than as status.
 * Nothing is drawn until the refresh has been running for DELAY_MS, so a
 * healthy network shows nothing at all and the bar comes to mean "this is
 * taking longer than it should", which is worth looking at.
 *
 * WHY IT IS NOT A SPINNER. It occupies no layout, blocks no touches and moves
 * nothing on the screen. It cannot become the thing the user waits on.
 */

/** Below this, a refresh is fast enough that saying so is noise. */
const DELAY_MS = 600;

/** One sweep of the travelling highlight. */
const SWEEP_MS = 1100;

/** Fade in and out, so it arrives and leaves rather than blinking. */
const FADE_MS = 220;

export function SyncBar({ active }: { active: boolean }) {
  // `active` is the refresh; `shown` is the bar, which lags it by DELAY_MS on
  // the way in and by the fade on the way out. Keeping them separate is what
  // stops a fast refresh from flashing.
  const [shown, setShown] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setShown(true), DELAY_MS);
    return () => clearTimeout(t);
  }, [active]);

  useEffect(() => {
    if (active || !shown) return;
    // The refresh finished. Fade out, then unmount, so the sweep animation is
    // not left running behind an invisible view.
    const anim = Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) setShown(false);
    });
    return () => anim.stop();
  }, [active, shown, opacity]);

  useEffect(() => {
    if (!shown) return;
    opacity.setValue(0);
    const fade = Animated.timing(opacity, {
      toValue: 1,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    fade.start();
    loop.start();
    return () => {
      fade.stop();
      loop.stop();
      sweep.setValue(0);
    };
  }, [shown, opacity, sweep]);

  if (!shown) return null;

  // Percentages rather than a measured width: the bar spans the screen, and
  // asking for onLayout would cost a render pass for a decoration. -40% to
  // 140% carries the highlight fully off both ends.
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: ['-40%', '140%'],
  });

  return (
    <Animated.View style={[styles.track, { opacity }]} pointerEvents="none">
      <Animated.View style={[styles.sweep, { transform: [{ translateX }] }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  track: {
    // Pinned above everything, outside the layout flow, so adding it to a
    // screen can never shift what is already on it.
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.creamDeep,
    overflow: 'hidden',
    zIndex: 999,
  },
  sweep: {
    width: '40%',
    height: 2,
    backgroundColor: colors.brandDeep,
  },
});

export default SyncBar;
