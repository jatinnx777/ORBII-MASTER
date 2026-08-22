import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { fontFamilies } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import {
  SceneHandsFree,
  SceneHelpers,
  SceneOffline,
  ScenePrivate,
  SceneReady,
  SceneVoice,
} from './illustrations/scenes';
import { requestOnboardingPermissions } from './permissions';

/**
 * ORBII onboarding.
 *
 * Replaces the previous sixteen-screen quiz. That flow asked for a name, how
 * she heard about us, her routine, her transport, her instincts and her
 * priorities before it had earned a single one of those answers, and it did all
 * that in front of somebody who had downloaded a safety app, which is rarely
 * something people do idly.
 *
 * Six screens now. Five explain what the app does, in the order the product
 * actually works, and the sixth asks for the two permissions without which none
 * of it functions. Nothing is collected that the app does not immediately need.
 *
 * THE LAYOUT, held to on every screen:
 *   - Illustration fills the top 54%, edge to edge, no card, no border.
 *   - A white sheet covers the bottom 46%, top corners at 36, overlapping the
 *     art so the two read as one surface rather than two stacked panels.
 *   - Heading, two lines, centred. Body, two lines, centred, grey.
 *   - One black pill button, full width.
 *   - Back chevron, a thin progress bar and Skip float over the artwork.
 *
 * Deliberately absent: circular badges orbiting the character. It is the most
 * copied motif in onboarding design and it makes a screen look like every other
 * screen.
 */

const C = {
  ink: '#141527',
  body: '#6B6B7B',
  sheet: '#FFFFFF',
  btn: '#141527',
  btnText: '#FFFFFF',
  track: 'rgba(255,255,255,0.45)',
  trackFill: '#FFFFFF',
  chrome: '#3A2A46',
};

type Step = {
  key: string;
  scene: () => React.ReactElement;
  title: string;
  body: string;
  cta: string;
};

const STEPS: Step[] = [
  {
    key: 'voice',
    scene: SceneVoice,
    title: 'Just say the word',
    body: 'Say "help, help" out loud and ORBII fires an SOS. No unlocking, no buttons, no searching for an app.',
    cta: "Let's Start!",
  },
  {
    key: 'hands',
    scene: SceneHandsFree,
    title: 'Works from your pocket',
    body: 'It keeps listening with the screen off and the phone in your bag, which is where it usually is.',
    cta: 'Next',
  },
  {
    key: 'offline',
    scene: SceneOffline,
    title: 'No signal? Still sent',
    body: 'Your alert goes out over SMS and hops phone to phone over Bluetooth when the network is gone.',
    cta: 'Next',
  },
  {
    key: 'helpers',
    scene: SceneHelpers,
    title: 'Someone actually comes',
    body: 'Your circle sees you live, and ID-verified helpers nearby are sent to you in waves until one arrives.',
    cta: 'Next',
  },
  {
    key: 'private',
    scene: ScenePrivate,
    title: 'Your voice never leaves',
    body: 'Listening happens on this phone. No audio is uploaded, stored on a server, or sold. Not ever.',
    cta: 'Next',
  },
  {
    key: 'ready',
    scene: SceneReady,
    title: 'Two things and you’re set',
    body: 'ORBII needs your microphone to hear you and your location to send help to the right place.',
    cta: 'Allow & finish',
  },
];

export function OnboardingScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // The sheet lifts a few pixels on each change. Small enough to feel like the
  // screen responded rather than like an animation is playing.
  const rise = useMemo(() => new Animated.Value(0), []);
  const play = useCallback(() => {
    rise.setValue(14);
    Animated.timing(rise, {
      toValue: 0,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [rise]);

  const finish = useCallback(() => {
    dispatch(onboardingCompleted());
  }, [dispatch]);

  const next = useCallback(async () => {
    if (busy) return;
    if (!last) {
      setI((v) => v + 1);
      play();
      return;
    }
    // The permission prompts are the only thing here that can fail, and a
    // refusal must not trap somebody on the last screen forever. Whatever they
    // answer, onboarding ends; the app explains what is missing later, in
    // context, where the ask actually means something.
    setBusy(true);
    await requestOnboardingPermissions();
    setBusy(false);
    finish();
  }, [busy, last, play, finish]);

  const back = useCallback(() => {
    if (i === 0) return;
    setI((v) => v - 1);
    play();
  }, [i, play]);

  const Art = step.scene;

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" />

      {/* ART */}
      <View style={styles.art}>
        <Art />
      </View>

      {/* CHROME, floating over the art */}
      <View style={[styles.chrome, { top: insets.top + 8 }]} pointerEvents="box-none">
        <Pressable
          onPress={back}
          hitSlop={12}
          style={[styles.chromeBtn, i === 0 && styles.chromeHidden]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={22} color={C.chrome} />
        </Pressable>

        <View style={styles.track}>
          <View style={[styles.trackFill, { width: `${((i + 1) / STEPS.length) * 100}%` }]} />
        </View>

        <Pressable
          onPress={finish}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding"
        >
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      {/* SHEET */}
      <Animated.View
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 16) + 12, transform: [{ translateY: rise }] },
        ]}
      >
        <Text style={styles.title}>{step.title}</Text>
        <Text style={styles.body}>{step.body}</Text>

        <Pressable
          onPress={() => void next()}
          disabled={busy}
          style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={step.cta}
        >
          {busy ? (
            <ActivityIndicator color={C.btnText} />
          ) : (
            <Text style={styles.ctaText}>{step.cta}</Text>
          )}
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#E3BFE6' },
  pressed: { opacity: 0.9 },

  // 58% so the sheet's rounded top can overlap it without clipping the figures.
  art: { position: 'absolute', left: 0, right: 0, top: 0, height: '58%' },

  chrome: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    zIndex: 3,
  },
  chromeBtn: { width: 26, alignItems: 'flex-start' },
  chromeHidden: { opacity: 0 },
  track: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.track,
    overflow: 'hidden',
  },
  trackFill: { height: '100%', borderRadius: 2, backgroundColor: C.trackFill },
  skip: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: '#FFFFFF' },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: '44%',
    backgroundColor: C.sheet,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    paddingHorizontal: 26,
    paddingTop: 34,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 25,
    lineHeight: 33,
    letterSpacing: -0.4,
    color: C.ink,
    textAlign: 'center',
  },
  body: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 13.5,
    lineHeight: 21,
    color: C.body,
    textAlign: 'center',
    marginTop: 12,
    maxWidth: 320,
  },
  cta: {
    marginTop: 'auto',
    alignSelf: 'stretch',
    height: 56,
    borderRadius: 28,
    backgroundColor: C.btn,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15.5,
    color: C.btnText,
  },
});
