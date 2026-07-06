import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { Mascot } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Walk with me: ORBII keeps her company on the way and checks in by voice.
// Every CHECK_EVERY_MS Orbi speaks a check-in and opens a response window;
// if she doesn't tap "I'm okay" in time, we escalate to the real SOS
// countdown (still cancellable, so a missed tap in a rickshaw isn't a false
// alarm catastrophe). All voice is on-device TTS; nothing is recorded.
const CHECK_EVERY_MS = 120_000;
const RESPOND_WINDOW_MS = 45_000;

function speak(text: string) {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'en-IN', pitch: 1.05, rate: 0.98 });
  } catch {
    // TTS is a comfort layer; never let it break the walk
  }
}

export function WalkWithMeScreen() {
  const navigation = useNavigation<Nav>();
  const profile = useAppSelector((s) => s.user.profile);
  const firstName = (profile?.name ?? '').trim().split(/\s+/)[0] || 'there';

  const [walking, setWalking] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(RESPOND_WINDOW_MS / 1000);
  const [checkIns, setCheckIns] = useState(0);

  const checkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const windowTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const walkingRef = useRef(false);

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  const breathe = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });

  const clearTimers = useCallback(() => {
    if (checkTimer.current) clearInterval(checkTimer.current);
    if (windowTimer.current) clearInterval(windowTimer.current);
    checkTimer.current = null;
    windowTimer.current = null;
  }, []);

  const escalate = useCallback(() => {
    clearTimers();
    deactivateKeepAwake('walk-with-me').catch(() => undefined);
    walkingRef.current = false;
    setWalking(false);
    setAwaiting(false);
    speak('No answer. Starting your S O S countdown now.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    navigation.navigate('SOSCountdown');
  }, [clearTimers, navigation]);

  const openWindow = useCallback(() => {
    if (!walkingRef.current) return;
    setAwaiting(true);
    setSecondsLeft(RESPOND_WINDOW_MS / 1000);
    setCheckIns((c) => c + 1);
    speak(`Still with you, ${firstName}. Tap I'm okay for me.`);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
    const startedAt = Date.now();
    windowTimer.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((RESPOND_WINDOW_MS - (Date.now() - startedAt)) / 1000));
      setSecondsLeft(left);
      if (left <= 0) {
        if (windowTimer.current) clearInterval(windowTimer.current);
        windowTimer.current = null;
        escalate();
      }
    }, 500);
  }, [escalate, firstName]);

  const start = () => {
    walkingRef.current = true;
    setWalking(true);
    setCheckIns(0);
    // Keep the screen on so the check-in timers + voice keep running through
    // the walk (JS timers pause when the screen sleeps). True screen-off
    // background needs a native service; this covers the walk itself.
    activateKeepAwakeAsync('walk-with-me').catch(() => undefined);
    const hour = new Date().getHours();
    const nightBit = hour >= 21 || hour < 5 ? " It's late, so I'll check in as we go." : " I'll check in as we go.";
    speak(`Okay ${firstName}, I'm walking with you.${nightBit}`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    checkTimer.current = setInterval(openWindow, CHECK_EVERY_MS);
  };

  const confirmOkay = () => {
    if (windowTimer.current) clearInterval(windowTimer.current);
    windowTimer.current = null;
    setAwaiting(false);
    speak('Good. Walk on, I’m here.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const endWalk = () => {
    clearTimers();
    deactivateKeepAwake('walk-with-me').catch(() => undefined);
    walkingRef.current = false;
    setWalking(false);
    setAwaiting(false);
    speak('Glad you’re safe. Bye for now.');
    navigation.goBack();
  };

  useEffect(
    () => () => {
      clearTimers();
      deactivateKeepAwake('walk-with-me').catch(() => undefined);
      try {
        Speech.stop();
      } catch {
        // ignore
      }
    },
    [clearTimers],
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable onPress={() => (walking ? endWalk() : navigation.goBack())} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Walk with me</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <Animated.View style={{ transform: [{ scale: breathe }] }}>
            <Mascot size={walking ? 200 : 230} />
          </Animated.View>

          {!walking ? (
            <>
              <Text style={styles.title}>I’ll walk you home.</Text>
              <Text style={styles.sub}>
                Orbi talks to you on the way and checks in every couple of minutes.
                If you go silent, ORBII starts your SOS, automatically.
              </Text>
              <View style={styles.noteRow}>
                <Ionicons name="volume-high" size={14} color={colors.sageDeep} />
                <Text style={styles.noteText}>Voice plays from your phone. Nothing is recorded.</Text>
              </View>
              <Pressable onPress={start} style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
                <Ionicons name="walk" size={18} color={colors.textPrimary} />
                <Text style={styles.ctaText}>Start walking</Text>
              </Pressable>
            </>
          ) : awaiting ? (
            <>
              <Text style={styles.title}>Are you okay?</Text>
              <Text style={styles.countdown}>{secondsLeft}s</Text>
              <Text style={styles.sub}>Tap the button or ORBII starts your SOS countdown.</Text>
              <Pressable onPress={confirmOkay} style={({ pressed }) => [styles.okayBtn, pressed && styles.pressed]}>
                <Text style={styles.okayText}>I’m okay</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.title}>Walking with you.</Text>
              <Text style={styles.sub}>
                {checkIns === 0
                  ? 'First check-in comes in about 2 minutes. Keep your volume up.'
                  : `${checkIns} check-in${checkIns === 1 ? '' : 's'} so far. All good.`}
              </Text>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Orbi is with you</Text>
              </View>
              <Pressable onPress={endWalk} style={({ pressed }) => [styles.endBtn, pressed && styles.pressed]}>
                <Text style={styles.endText}>I reached safely, end walk</Text>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  sub: { ...typography.body, fontSize: 14.5, color: colors.textSecondary, textAlign: 'center', maxWidth: 320 },
  countdown: { fontFamily: fontFamilies.poppinsBold, fontSize: 52, color: colors.coralDeep, letterSpacing: -1 },
  noteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.xs },
  noteText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.peach,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    marginTop: spacing.lg,
    ...shadows.card,
  },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  pressed: { transform: [{ scale: 0.97 }], opacity: 0.95 },
  okayBtn: {
    backgroundColor: colors.sage,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.lg,
    marginTop: spacing.md,
    ...shadows.card,
  },
  okayText: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: colors.textInverse },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.sageSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    marginTop: spacing.xs,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.sageDeep },
  liveText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.sageDeep },
  endBtn: { marginTop: spacing.lg, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  endText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textSecondary, textDecorationLine: 'underline' },
});
