import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { endSafeJourney, startSafeJourney } from '@/services/circles';
import { isCircleSharing, startCircleSharing, stopCircleSharing } from '@/services/circle-location';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Walk with me: ORBII keeps her company on the way and checks in by voice.
// Every check interval ORBII speaks a check-in and opens a response window;
// if she doesn't tap "I'm okay" in time, we escalate to the real SOS
// countdown (still cancellable, so a missed tap in a rickshaw isn't a false
// alarm catastrophe). All voice is on-device TTS; nothing is recorded.
/**
 * How often ORBII asks, in minutes.
 *
 * Her choice, not ours. Every minute is right for the five minutes between a
 * gate and a hostel door; every five is right for a long walk where being
 * asked twelve times is what makes somebody turn the feature off. A safety
 * prompt that becomes annoying gets disabled, and a disabled prompt protects
 * nobody, so the interval is the setting rather than a constant we defend.
 */
const CHECK_OPTIONS = [1, 2, 5] as const;
const DEFAULT_CHECK_MIN = 2;

/**
 * How long she has to answer before ORBII treats silence as trouble.
 *
 * Deliberately generous. A phone in a bag, a glove, or a hand holding
 * something else all cost seconds, and the cost of being slightly slow must
 * not be a false SOS to four people.
 */
const RESPOND_WINDOW_MS = 45_000;

/**
 * The best voice this phone actually has, chosen once.
 *
 * expo-speech with only a language tag takes whatever the system picked, which
 * on most Android phones is the lowest-quality installed engine and sounds
 * like a railway announcement. Android usually also ships a better one, and
 * the good ones are identifiable: Google's network and local voices carry
 * `quality` and name themselves `en-in-x-...`.
 *
 * Preference order, and the reasoning:
 *   1. en-IN, because she is being spoken to in her own accent and an American
 *      voice saying her name wrong at midnight is not comforting.
 *   2. en-GB, which is closer to Indian English than en-US.
 *   3. Anything English.
 *   4. Nothing, and the system default handles it.
 *
 * Resolved lazily and cached: getAvailableVoicesAsync is slow enough to matter
 * on the first spoken line, and the walk starts with one.
 */
let cachedVoice: string | null | undefined;

async function resolveVoice(): Promise<string | null> {
  if (cachedVoice !== undefined) return cachedVoice;
  cachedVoice = null;
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const score = (v: { identifier: string; language: string; quality?: unknown }) => {
      const lang = (v.language || '').toLowerCase();
      const id = (v.identifier || '').toLowerCase();
      let n = 0;
      if (lang.startsWith('en-in') || lang === 'en_in') n += 100;
      else if (lang.startsWith('en-gb') || lang === 'en_gb') n += 60;
      else if (lang.startsWith('en')) n += 30;
      else return -1;
      // Enhanced voices report a quality; the default ones usually do not.
      if (String(v.quality ?? '').toLowerCase().includes('enhanced')) n += 25;
      if (id.includes('network')) n += 15;
      if (id.includes('google')) n += 10;
      return n;
    };
    const best = voices
      .map((v) => ({ v, n: score(v as never) }))
      .filter((x) => x.n >= 0)
      .sort((a, b) => b.n - a.n)[0];
    cachedVoice = best ? best.v.identifier : null;
  } catch {
    cachedVoice = null;
  }
  return cachedVoice;
}

function speak(text: string) {
  void (async () => {
    try {
      Speech.stop();
      const voice = await resolveVoice();
      Speech.speak(text, {
        language: 'en-IN',
        // Slightly slower and slightly lower than the old settings. The
        // previous 1.05 pitch read as chirpy, which is the wrong register for
        // a voice whose job is to be steady while somebody walks home alone.
        pitch: 1.0,
        rate: 0.94,
        ...(voice ? { voice } : {}),
      });
    } catch {
      // TTS is a comfort layer; never let it break the walk.
    }
  })();
}

export function WalkWithMeScreen() {
  const navigation = useNavigation<Nav>();
  const profile = useAppSelector((s) => s.user.profile);
  const firstName = (profile?.name ?? '').trim().split(/\s+/)[0] || 'there';

  const [walking, setWalking] = useState(false);
  /**
   * The circle this walk is announced to, and the journey row it created.
   *
   * WALK WITH ME IS A SAFETY JOURNEY NOW, not a second system. It was an
   * on-device voice companion that never touched the circle: ORBII talked to
   * her, and if she stopped answering it raised an SOS, which is genuinely
   * useful and entirely invisible to the four people it was for.
   *
   * It keeps every bit of that and adds the announcement, so the same walk is
   * both "somebody is talking to me" and "my circle knows I am walking". The
   * kind is 'walk', the ETA is the duration she picked, and the map, the
   * overdue sweep and the arrival handling are all inherited from sql/139. No
   * new table, no new Edge Function.
   */
  const circleId = useAppSelector((st) => st.circles.activeCircleId);
  const tripRef = useRef<string | null>(null);
  const [minutes, setMinutes] = useState(30);
  const [checkEveryMin, setCheckEveryMin] = useState<number>(DEFAULT_CHECK_MIN);
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
    checkTimer.current = setInterval(openWindow, checkEveryMin * 60_000);

    // TELL THE CIRCLE. Not awaited: the voice companion and the escalation
    // above are the safety net and they work with no network at all. This is
    // the part that tells other people, and it must never be able to delay the
    // walk starting.
    void (async () => {
      try {
        if (!circleId) return;
        const id = await startSafeJourney({
          circleId,
          label: 'Walking home',
          kind: 'walk',
          etaMs: Date.now() + minutes * 60_000,
        });
        tripRef.current = id;
        // Sharing runs slightly past the walk, so being a few minutes slow is
        // not the moment her pin goes dark.
        if (!(await isCircleSharing())) {
          await startCircleSharing(Math.max(0.5, minutes / 60 + 0.25));
        }
      } catch {
        // Silent. She is walking; a failed announcement is not something to
        // interrupt her with.
      }
    })();
  };

  /**
   * She said no.
   *
   * Straight to the SOS countdown, with no second confirmation. The countdown
   * itself is the confirmation and it is still cancellable, so asking "are you
   * sure" here would be asking the same question twice of somebody who has
   * already answered it once under pressure.
   *
   * The circle is alerted by the SOS pipeline, which is the one place that
   * knows how to fan out, honour revocation and respect her plan. Sending a
   * second alert from here would mean two messages for one event.
   */
  const answerNo = useCallback(() => {
    if (windowTimer.current) clearInterval(windowTimer.current);
    windowTimer.current = null;
    clearTimers();
    deactivateKeepAwake('walk-with-me').catch(() => undefined);
    walkingRef.current = false;
    setWalking(false);
    setAwaiting(false);
    speak('Okay. Starting your S O S now.');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    navigation.navigate('SOSCountdown');
  }, [clearTimers, navigation]);

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

    // Close it for the circle and stop the sharing the walk armed. Leaving
    // either running would keep her visible for a walk that finished, which is
    // the failure a bounded-sharing product is least allowed to have.
    const trip = tripRef.current;
    tripRef.current = null;
    void (async () => {
      try {
        if (trip) await endSafeJourney(trip, true);
      } catch {
        // The sweep leaves arrived journeys alone; a stale row is the smaller
        // harm compared with blocking her on a network call.
      }
      try {
        // notify: false. They are being told she arrived; a second alert saying
        // her location stopped describes the same event twice.
        if (await isCircleSharing()) await stopCircleSharing({ notify: false });
      } catch {
        // ignore
      }
    })();

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
          {/* NO CIRCLE, AND NOTHING BREATHING.
              A pulsing round mascot was the largest object on a screen whose
              job is to ask one question and take one answer. On the check-in
              state it competed with the countdown; while walking it was
              decoration on a screen nobody is looking at. What is left is a
              thin progress line, which says the one thing worth saying: how
              far through the walk she is. */}
          {walking ? (
            <View style={styles.progressTrack}>
              <Animated.View
                style={[styles.progressFill, { transform: [{ scaleX: breathe }] }]}
              />
            </View>
          ) : null}

          {!walking ? (
            <>
              <Text style={styles.title}>I’ll walk you home.</Text>
              <Text style={styles.sub}>
                ORBII talks to you on the way and checks in every couple of minutes.
                If you go silent, ORBII starts your SOS, automatically.
              </Text>
              <View style={styles.noteRow}>
                <Ionicons name="volume-high" size={14} color={colors.sageDeep} />
                <Text style={styles.noteText}>Voice plays from your phone. Nothing is recorded.</Text>
              </View>

              {/* HOW LONG THE WALK SHOULD TAKE.
                  Not decoration: this is the ETA her circle sees, and it is
                  what the overdue sweep counts from. Four presets rather than a
                  picker, because somebody about to walk home in the dark should
                  be choosing between four taps, not scrolling a wheel. */}
              <Text style={styles.durationLabel}>How long should this take?</Text>
              <View style={styles.durationRow}>
                {[15, 30, 45, 60].map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setMinutes(m);
                      Haptics.selectionAsync().catch(() => undefined);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: minutes === m }}
                    style={[styles.duration, minutes === m && styles.durationOn]}
                  >
                    <Text style={[styles.durationText, minutes === m && styles.durationTextOn]}>
                      {m} min
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* HOW OFTEN SHE WANTS ASKING. Her call, not ours: every
                  minute suits the five minutes between a gate and a hostel
                  door, every five suits a long walk where twelve prompts is
                  what makes somebody switch the feature off. */}
              <Text style={styles.durationLabel}>Check in on me every</Text>
              <View style={styles.durationRow}>
                {CHECK_OPTIONS.map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => {
                      setCheckEveryMin(m);
                      Haptics.selectionAsync().catch(() => undefined);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: checkEveryMin === m }}
                    style={[styles.duration, checkEveryMin === m && styles.durationOn]}
                  >
                    <Text
                      style={[styles.durationText, checkEveryMin === m && styles.durationTextOn]}
                    >
                      {m} min
                    </Text>
                  </Pressable>
                ))}
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
              <Text style={styles.sub}>
                No answer in {secondsLeft}s and ORBII starts your SOS countdown.
              </Text>
              {/* TWO ANSWERS, NOT ONE.
                  Before this there was only "I'm okay", so the way to say
                  anything was wrong was to say nothing and wait out 45
                  seconds. Somebody who has just realised she is being followed
                  should not have to stand still and wait for a timer to agree
                  with her. No is now a button, and it does not wait. */}
              <View style={styles.answerRow}>
                <Pressable
                  onPress={answerNo}
                  style={({ pressed }) => [styles.noBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel="No, I am not okay. Start my SOS."
                >
                  <Ionicons name="alert-circle" size={18} color={colors.textInverse} />
                  <Text style={styles.noText}>No</Text>
                </Pressable>
                <Pressable
                  onPress={confirmOkay}
                  style={({ pressed }) => [styles.okayBtn, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <Text style={styles.okayText}>I’m okay</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.title}>Walking with you.</Text>
              <Text style={styles.sub}>
                {checkIns === 0
                  ? `First check-in in about ${checkEveryMin} minute${checkEveryMin === 1 ? '' : 's'}. Keep your volume up.`
                  : `${checkIns} check-in${checkIns === 1 ? '' : 's'} so far. All good.`}
              </Text>
              <View style={styles.liveRow}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>ORBII is with you</Text>
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
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(23,22,28,0.08)',
    alignSelf: 'stretch',
    marginBottom: spacing.xl,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.brandDeep,
    // scaleX is driven from the existing animated value, so the line has a
    // slow pulse instead of the mascot's. transform only: it stays on the
    // native driver and off the JS thread.
    width: '100%',
  },
  answerRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  noBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 22,
    paddingVertical: 15,
    borderRadius: radius.pill,
    backgroundColor: colors.coralDeep,
  },
  noText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    color: colors.textInverse,
  },
  durationLabel: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13.5,
    color: colors.textMuted,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  durationRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', flexWrap: 'wrap' },
  duration: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  durationOn: { borderColor: colors.brandDeep, backgroundColor: colors.brandSoft },
  durationText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textSecondary,
  },
  durationTextOn: { color: colors.brandDeep },
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
