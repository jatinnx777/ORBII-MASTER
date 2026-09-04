import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, fontFamilies, radius, spacing } from '@/theme';

/**
 * The voice step's visual, and the one screen in first run that has to sell
 * something rather than collect it.
 *
 * Every other step asks for a fact she already has: an email, a name, a number.
 * This one asks her to believe that saying a word out loud will summon help,
 * which is the entire product and the hardest thing in the app to believe. A
 * row of text pills was not going to do it.
 *
 * WHEN IT IS OFF the words sit still and the ring is quiet, because nothing is
 * listening yet and pretending otherwise on a safety app is the exact lie this
 * project keeps refusing to tell.
 *
 * WHEN IT IS ARMED three rings breathe outward on a loop. That loop is the only
 * continuous animation in the whole flow, and it earns the exception: it is
 * saying "this is running now", which is a fact she cannot otherwise see and
 * will have to trust for the next twelve hours.
 */

const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function Listening({ armed, words }: { armed: boolean; words: string[] }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setReduced)
      .catch(() => undefined);
  }, []);

  const rings = [
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
    useRef(new Animated.Value(0)).current,
  ];

  useEffect(() => {
    if (!armed || reduced) {
      rings.forEach((r) => r.setValue(0));
      return;
    }
    const loops = rings.map((r, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 700),
          Animated.timing(r, {
            toValue: 1,
            duration: 2100,
            easing: EASE_OUT,
            useNativeDriver: true,
          }),
          Animated.timing(r, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, reduced]);

  return (
    <View style={s.wrap}>
      <View style={s.stage}>
        {armed && !reduced
          ? rings.map((r, i) => (
              <Animated.View
                key={i}
                pointerEvents="none"
                style={[
                  s.ring,
                  {
                    opacity: r.interpolate({
                      inputRange: [0, 0.1, 1],
                      outputRange: [0, 0.22, 0],
                    }),
                    transform: [
                      { scale: r.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] }) },
                    ],
                  },
                ]}
              />
            ))
          : null}

        <View style={[s.core, armed && s.coreOn]}>
          <View style={s.bars}>
            {[10, 18, 26, 18, 10].map((h, i) => (
              <View
                key={i}
                style={[
                  s.bar,
                  { height: armed ? h : 10 },
                  armed && { backgroundColor: colors.textInverse },
                ]}
              />
            ))}
          </View>
        </View>
      </View>

      <View style={s.words}>
        {words.map((w) => (
          <View key={w} style={[s.word, armed && s.wordOn]}>
            <Text style={[s.wordText, armed && s.wordTextOn]}>{w}</Text>
          </View>
        ))}
      </View>

      <Text style={[s.status, armed && s.statusOn]}>
        {armed ? 'Listening now' : 'Not listening yet'}
      </Text>
    </View>
  );
}

const CORE = 92;

const s = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.lg },
  stage: {
    height: CORE + 40,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  ring: {
    position: 'absolute',
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    backgroundColor: colors.coral,
  },
  core: {
    width: CORE,
    height: CORE,
    borderRadius: CORE / 2,
    backgroundColor: colors.creamDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coreOn: { backgroundColor: colors.coralDeep },

  bars: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30 },
  bar: { width: 4, borderRadius: 2, backgroundColor: colors.textMuted },

  words: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  word: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.creamDeep,
  },
  wordOn: { backgroundColor: colors.coralSoft },
  wordText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textSecondary,
  },
  wordTextOn: { color: colors.coralDeep },

  status: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 0.3,
    color: colors.textMuted,
  },
  statusOn: { color: colors.coralDeep },
});
