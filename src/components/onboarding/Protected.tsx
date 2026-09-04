import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius, spacing } from '@/theme';

/**
 * The payoff. The only screen in first run that gets a real animation budget.
 *
 * The skill's tiering puts first-time success states in the delight tier, and
 * this is the one moment in ORBII that qualifies: it happens once per person,
 * ever, and it is the sentence the whole flow exists to earn.
 *
 * It is also the honest answer to the thing that made the old onboarding
 * dangerous. Twenty-nine screens meant most people stopped somewhere in the
 * middle, and a person who stops halfway through setting up a safety app
 * believes she has one. Nobody reaches this screen without actually being
 * covered, so the sentence on it is true.
 *
 * Three rings expand and fade outward, then the mark settles. Staggered, not
 * simultaneous, because simultaneous reads as one shape flashing and staggered
 * reads as something switching on.
 */

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function Protected({
  lines,
  ctaLabel,
  onDone,
}: {
  /** What is actually live. Never a generic list: only what she just set up. */
  lines: string[];
  ctaLabel: string;
  onDone: () => void;
}) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
  }, []);

  const mark = useRef(new Animated.Value(0)).current;
  const copy = useRef(new Animated.Value(0)).current;
  // Three pulses, each its own value so they can be staggered.
  const pulses = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    if (reduced) {
      mark.setValue(1);
      copy.setValue(1);
      return;
    }

    Animated.sequence([
      // Never from scale 0. Nothing in the real world appears from nothing.
      Animated.timing(mark, {
        toValue: 1,
        duration: 420,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
      Animated.timing(copy, {
        toValue: 1,
        duration: 300,
        easing: EASE_OUT,
        useNativeDriver: true,
      }),
    ]).start();

    // Success, fired with the mark landing rather than at the end of the
    // sequence, because the mark is the causal moment.
    const t = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    }, 220);

    const rings = Animated.stagger(
      260,
      pulses.map((p) =>
        Animated.timing(p, {
          toValue: 1,
          duration: 1600,
          easing: EASE_OUT,
          useNativeDriver: true,
        }),
      ),
    );
    rings.start();

    return () => {
      clearTimeout(t);
      rings.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <View style={styles.center}>
        <View style={styles.markWrap}>
          {!reduced
            ? pulses.map((p, i) => (
                <Animated.View
                  key={i}
                  pointerEvents="none"
                  style={[
                    styles.pulse,
                    {
                      opacity: p.interpolate({
                        inputRange: [0, 0.15, 1],
                        outputRange: [0, 0.28, 0],
                      }),
                      transform: [
                        {
                          scale: p.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0.9, 2.1],
                          }),
                        },
                      ],
                    },
                  ]}
                />
              ))
            : null}

          <Animated.View
            style={[
              styles.mark,
              {
                opacity: mark,
                transform: [
                  { scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              },
            ]}
          >
            <Ionicons name="shield-checkmark" size={40} color={colors.textInverse} />
          </Animated.View>
        </View>

        <Animated.View
          style={{
            opacity: copy,
            transform: reduced
              ? []
              : [{ translateY: copy.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
          }}
        >
          <Text style={styles.title}>You are protected</Text>
          <View style={styles.lines}>
            {lines.map((l) => (
              <View key={l} style={styles.line}>
                <Ionicons name="checkmark" size={16} color={colors.sageDeep} />
                <Text style={styles.lineText}>{l}</Text>
              </View>
            ))}
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, { opacity: copy }]}>
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.92 }]}
        >
          <Text style={styles.ctaText}>{ctaLabel}</Text>
        </Pressable>
        <Text style={styles.foot}>
          You can add safe zones, evidence and more from the Safety tab whenever you want.
        </Text>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg },

  markWrap: { alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  pulse: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.sage,
  },
  mark: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.sageDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },

  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    letterSpacing: -0.7,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  lines: { marginTop: spacing.lg, gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  lineText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 15,
    color: colors.textSecondary,
  },

  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  cta: {
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 17, color: colors.textInverse },
  foot: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
