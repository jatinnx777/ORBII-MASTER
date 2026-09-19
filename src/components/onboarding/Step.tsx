import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius } from '@/theme';

/**
 * One screen of first run.
 *
 * THE LAYOUT IS REVOLUT'S, deliberately and closely.
 *
 * What their onboarding does, and what this now does:
 *
 *   - A flat, near-white ground. No drifting gradient behind the content, no
 *     soft field, no texture. The screen is a sheet of paper with a question
 *     on it.
 *   - One enormous heading, left aligned, tight. Roughly twice the size a
 *     heading usually is, owning the top third of the screen on its own. This
 *     is the single biggest reason their flow reads as calm: there is visibly
 *     one thing per screen.
 *   - A grey sentence under it, and nothing else competing.
 *   - No progress bar and no "2 of 8" counter. Revolut never tells you how far
 *     through you are and the flow feels shorter for it. Our old shell had
 *     both, and a counter reading two of eight is a number that closes apps.
 *   - A bare back arrow, top left. No word "Back", no chip, no circle.
 *   - Deliberate empty space in the middle. Where an illustration exists it
 *     sits in that space, centred, the way the flag does on their citizenship
 *     screen.
 *   - The action is a full width pill pinned to the bottom, in the same place
 *     on every step. Disabled is a pale tint of the same colour rather than
 *     grey, so the button never looks broken, only not ready.
 *
 * WHAT IS NOT COPIED: the colour. Revolut's blue is Revolut's. The pill is
 * ORBII lavender and the ground is a hair warm, so the layout is theirs and
 * the product is still ours.
 *
 * MOTION. Steps are seen once, so they get a standard animation rather than
 * the near-zero budget a tab switch gets: each arrives from below and settles,
 * transform and opacity only, native driver, ease-out. Reduced motion keeps
 * the fade and drops the movement.
 */

/** Strong ease-out. The platform's own easings are too weak to read as motion. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const ENTER_MS = 260;
const PRESS_MS = 120;

export type StepProps = {
  /** 1-based. Kept for the screen reader; nothing is drawn from it any more. */
  index: number;
  total: number;
  /** Unused by this layout. Kept so every caller need not change at once. */
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  tint?: string;
  /**
   * An illustration, centred in the empty middle of the screen.
   *
   * Optional, and most steps should not have one. Revolut's flow is mostly
   * type and space, and a picture on every screen is what makes an onboarding
   * feel padded.
   */
  scene?: React.ReactNode;
  /** Width over height. The painted illustrations are 1024x1536, so 2/3. */
  sceneAspect?: number;
  /** Kept for the sign-in path, which is not a wizard. Draws nothing now. */
  bare?: boolean;
  title: string;
  /** One sentence under the title. Optional: some steps are the sentence. */
  blurb?: string;
  children?: React.ReactNode;
  ctaLabel: string;
  onNext: () => void | Promise<void>;
  ctaDisabled?: boolean;
  busy?: boolean;
  /** Shown small and quiet above the button. Never a second button. */
  footnote?: string;
  onBack?: () => void;
};

export function Step({
  index,
  total,
  scene,
  sceneAspect = 2 / 3,
  title,
  blurb,
  children,
  ctaLabel,
  onNext,
  ctaDisabled,
  busy,
  footnote,
  onBack,
}: StepProps) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);

  // One value drives both the fade and the rise, so they can never desync.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    enter.setValue(0);
    Animated.timing(enter, {
      toValue: 1,
      duration: ENTER_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
  }, [enter, title]);

  const press = useRef(new Animated.Value(0)).current;
  const setPressed = (down: boolean) =>
    Animated.timing(press, {
      toValue: down ? 1 : 0,
      duration: PRESS_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();

  const disabled = !!ctaDisabled || !!busy;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Animated.View
          style={[
            styles.body,
            {
              opacity: enter,
              transform: reduced
                ? []
                : [
                    {
                      translateY: enter.interpolate({
                        inputRange: [0, 1],
                        outputRange: [14, 0],
                      }),
                    },
                  ],
            },
          ]}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* A bare arrow. Revolut spends nothing on going back, because
                going back is not what the screen is for. */}
            <View style={styles.topRow}>
              {onBack ? (
                <Pressable
                  onPress={onBack}
                  hitSlop={16}
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  style={styles.backHit}
                >
                  <Ionicons name="arrow-back" size={26} color={colors.textPrimary} />
                </Pressable>
              ) : null}
            </View>

            <Text
              style={styles.title}
              accessibilityRole="header"
              // The counter is off the screen now, so this is the only place
              // the position still exists for somebody using a screen reader.
              accessibilityLabel={`${title}. Step ${index} of ${total}.`}
            >
              {title}
            </Text>
            {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}

            {children ? <View style={styles.slot}>{children}</View> : null}

            {/* The empty middle, and the illustration in it when there is one.
                flexGrow on the scroll content is what pushes this down and
                holds the action at the bottom on a tall phone. */}
            {scene ? (
              <View style={styles.sceneWrap}>
                <View style={[styles.scene, { aspectRatio: sceneAspect }]}>{scene}</View>
              </View>
            ) : (
              <View style={styles.spacer} />
            )}
          </ScrollView>

          <View style={styles.footer}>
            {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
            <Animated.View
              style={{
                transform: [
                  { scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.97] }) },
                ],
              }}
            >
              <Pressable
                onPress={() => {
                  if (disabled) return;
                  // Same frame as the visual commit, not when the next screen
                  // finishes animating. A late haptic reads as a glitch.
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
                  void onNext();
                }}
                onPressIn={() => !disabled && setPressed(true)}
                onPressOut={() => setPressed(false)}
                // A finger drifting a few pixels should not cancel a press she meant.
                pressRetentionOffset={{ top: 12, bottom: 12, left: 12, right: 12 }}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityState={{ disabled }}
                style={[styles.cta, disabled && styles.ctaOff]}
              >
                <Text style={[styles.ctaText, disabled && styles.ctaTextOff]}>
                  {busy ? 'One moment' : ctaLabel}
                </Text>
              </Pressable>
            </Animated.View>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The flat ground. Near-white, a hair warm, so it is not Revolut's grey. */
const GROUND = '#F7F6F2';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: GROUND },
  body: { flex: 1, backgroundColor: GROUND },

  // flexGrow is load-bearing: it lets the spacer expand and hold the action at
  // the bottom of a tall screen, while still scrolling on a short one.
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 16,
  },

  topRow: { height: 44, justifyContent: 'center' },
  backHit: { width: 44, height: 44, justifyContent: 'center', marginLeft: -6 },

  // THE HEADING IS THE DESIGN. 40pt, tight leading, tight tracking, left
  // aligned, nothing sharing its line. Two lines of this fills the top third
  // of the screen, which is exactly what theirs does.
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 40,
    lineHeight: 44,
    letterSpacing: -1.4,
    color: colors.textPrimary,
    marginTop: 16,
  },
  blurb: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 17,
    lineHeight: 25,
    color: colors.textSecondary,
    marginTop: 12,
  },

  slot: { marginTop: 28, gap: 12 },

  // Nothing in it. It exists to push the action to the bottom.
  spacer: { flexGrow: 1, minHeight: 24 },

  sceneWrap: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 24 },
  // 62% keeps a 2:3 portrait to about 240 by 360 on a normal phone, so it sits
  // in the empty middle the way their flag does instead of becoming a banner.
  scene: { width: '62%', borderRadius: radius.lg, overflow: 'hidden' },

  footer: { paddingHorizontal: 24, paddingBottom: 12, gap: 14 },

  // The pill. Taller than our usual button because it is the only one on the
  // screen, and in the same place on every step.
  cta: {
    height: 62,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A pale tint of the same colour, not grey. Their disabled button still
  // reads as the button: not ready, rather than broken.
  ctaOff: { backgroundColor: '#D9D0F0' },
  ctaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17.5,
    color: colors.textInverse,
  },
  ctaTextOff: { color: '#FFFFFF' },

  footnote: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
});
