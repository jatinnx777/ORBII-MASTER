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
import { colors, fontFamilies, radius, spacing } from '@/theme';

/**
 * One screen of first run, and the only place motion is defined for it.
 *
 * MOTION DECISIONS, made once here so no screen has to make them again:
 *
 * - Onboarding steps are the "occasional" tier: seen once, never repeated. That
 *   earns a standard animation, not the near-zero budget a tab switch gets.
 * - Purpose is EXPLANATION. Each step arrives from below and settles, so the
 *   flow reads as forward movement through one thing rather than as six
 *   unrelated screens replacing each other.
 * - transform and opacity only, on the native driver, so a mid-range Android
 *   under load animates at the same rate as a flagship.
 * - ease-out on enter. Never ease-in on UI: it starts slow and delays the exact
 *   moment the user is looking.
 * - Reduced motion drops the translation and keeps the fade, because the fade
 *   is what says "this is a new step" and the movement is only decoration.
 */

/** Strong ease-out. The platform's own easings are too weak to read as motion. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

const ENTER_MS = 260;
const PRESS_MS = 120;
/** The one place the progress bar is timed, so it can never drift from the step. */
const PROGRESS_MS = 320;

export type StepProps = {
  /** 1-based, for the progress bar and the screen reader. */
  index: number;
  total: number;
  /** Gives the step a face. Without one, six screens of type look identical. */
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** The icon's colour. Each step gets its own so the flow has a palette. */
  tint: string;
  title: string;
  /** One sentence under the title. Optional: some steps are the sentence. */
  blurb?: string;
  children?: React.ReactNode;
  ctaLabel: string;
  onNext: () => void | Promise<void>;
  ctaDisabled?: boolean;
  busy?: boolean;
  /** Shown small and quiet under the button. Never a second button. */
  footnote?: string;
  onBack?: () => void;
};

export function Step({
  index,
  total,
  icon,
  tint,
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
      duration: reduced ? 160 : ENTER_MS,
      easing: EASE_OUT,
      useNativeDriver: true,
    }).start();
    // Announced rather than left to the reader to discover, because the screen
    // replaces itself in place and a screen reader has nothing to notice.
    AccessibilityInfo.announceForAccessibility(`Step ${index} of ${total}. ${title}`);
  }, [index, reduced, enter, title, total]);

  // Absolutely positioned, no children, so animating width is the documented
  // exception rather than a layout pass: nothing else re-lays out.
  const progress = useRef(new Animated.Value((index - 1) / total)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: index / total,
      duration: reduced ? 0 : PROGRESS_MS,
      easing: EASE_OUT,
      useNativeDriver: false,
    }).start();
  }, [index, total, reduced, progress]);

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
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
              }),
            },
          ]}
        />
      </View>

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
            <View style={styles.topRow}>
              {onBack ? (
                <Pressable onPress={onBack} hitSlop={12} style={styles.backHit}>
                  <Ionicons name="chevron-back" size={20} color={colors.textSecondary} />
                  <Text style={styles.back}>Back</Text>
                </Pressable>
              ) : (
                <View />
              )}
              {/* Said out loud rather than left to a 3px bar. Knowing there are
                  six and this is the second is most of what makes a flow feel
                  short, and the old one never said. */}
              <Text style={styles.counter}>
                {index} of {total}
              </Text>
            </View>

            <View style={[styles.badge, { backgroundColor: tint + '1A' }]}>
              <Ionicons name={icon} size={26} color={tint} />
            </View>

            <Text style={styles.title}>{title}</Text>
            {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
            {children ? <View style={styles.slot}>{children}</View> : null}
          </ScrollView>

          <View style={styles.footer}>
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
            {footnote ? <Text style={styles.footnote}>{footnote}</Text> : null}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  track: { height: 3, backgroundColor: colors.creamDeep, width: '100%' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.brandDeep },

  body: { flex: 1 },
  scroll: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    minHeight: 28,
  },
  backHit: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: spacing.xs },
  back: { fontFamily: fontFamilies.interRegular, fontSize: 15, color: colors.textSecondary },
  counter: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    letterSpacing: 0.4,
    color: colors.textMuted,
  },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },

  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    lineHeight: 37,
    letterSpacing: -0.7,
    color: colors.textPrimary,
  },
  blurb: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  slot: { marginTop: spacing.xl, gap: spacing.md },

  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  cta: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOff: { backgroundColor: colors.creamDeep },
  ctaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    color: colors.textInverse,
  },
  ctaTextOff: { color: colors.textMuted },
  footnote: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
