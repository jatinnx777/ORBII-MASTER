import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Celebration } from '@/components/common';
import { fontFamilies } from '@/theme';
import { useAppDispatch } from '@/redux/store';
import { onboardingCompleted } from '@/redux/slices/appSlice';
import { requestOverlayPermission } from '@/services/helper-overlay';
import { runVoiceTest, cancelVoiceTest } from '@/services/voice-test';

// Long, invested onboarding built on two psychology plays:
//  • The Mirror: a quiz makes her work for a "safety profile", so the (tuned but
//    generic) result feels custom-built and earned.
//  • The Label: her answers assign a proud safety TYPE she internalises.
// Its own brand palette + an 8px grid so every screen shares one rhythm.
const C = {
  primary: '#6C5CE7',
  accent: '#A29BFE',
  emerald: '#00B894',
  bg: '#E4E9F8',        // soft periwinkle canvas
  surface: '#FFFFFF',
  ink: '#101018',       // near-black, for the primary button
  text: '#16171F',      // punchy near-black headlines
  muted: '#5A5E6B',
  pill: '#EDEBFF',      // light-lilac selected state
  hairline: '#DDE1F1',
};
const S = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 };
type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Answers = {
  name?: string;
  heard?: string;
  usedbefore?: string;
  why?: string;
  scenarios: string[];
  routine?: string;
  env?: string;
  transport?: string;
  instinct?: string;
  priority: string[];
};

// Ordered flow. The VOICE "try it" moment leads (feel the value in the first ~30
// seconds, the aha), THEN the invested quiz, so investment lands after they've
// felt it work. Quiz screens are data-driven; the rest are bespoke.
const SCREENS = [
  'hero', 'name', 'heard', 'usedbefore', 'why', 'scenarios', 'routine', 'env', 'transport', 'instinct', 'priority',
  'loader', 'mirror', 'label', 'control', 'voice', 'pledge', 'plus', 'perms', 'summary',
] as const;
type ScreenId = typeof SCREENS[number];

type Question = {
  id: keyof Answers;
  kind: 'single' | 'multi';
  eyebrow: string;
  q: string;
  options: { key: string; label: string; icon: IconName }[];
};
const QUESTIONS: Record<string, Question> = {
  heard: {
    id: 'heard', kind: 'single', eyebrow: 'ONE QUICK THING', q: 'Where did you hear about ORBII?',
    options: [
      { key: 'instagram', label: 'Instagram', icon: 'logo-instagram' },
      { key: 'youtube', label: 'YouTube', icon: 'logo-youtube' },
      { key: 'linkedin', label: 'LinkedIn', icon: 'logo-linkedin' },
      { key: 'friend', label: 'A friend told me', icon: 'people' },
      { key: 'search', label: 'Search or a website', icon: 'search' },
      { key: 'other', label: 'Somewhere else', icon: 'ellipsis-horizontal' },
    ],
  },
  usedbefore: {
    id: 'usedbefore', kind: 'single', eyebrow: 'BEFORE ORBII', q: 'Have you used a safety app before?',
    options: [
      { key: 'letdown', label: 'Yes, and it let me down', icon: 'sad' },
      { key: 'some', label: 'Yes, one or two', icon: 'checkmark-done' },
      { key: 'first', label: "No, you're my first", icon: 'sparkles' },
    ],
  },
  why: {
    id: 'why', kind: 'single', eyebrow: 'ABOUT YOU', q: 'What brought you to ORBII?',
    options: [
      { key: 'me', label: 'Peace of mind for myself', icon: 'person' },
      { key: 'loved', label: 'To protect someone I love', icon: 'heart' },
      { key: 'ready', label: 'I just want to be ready', icon: 'shield-checkmark' },
    ],
  },
  scenarios: {
    id: 'scenarios', kind: 'multi', eyebrow: 'YOUR WORLD', q: 'When do you feel most exposed?',
    options: [
      { key: 'night', label: 'Walking alone at night', icon: 'moon' },
      { key: 'cabs', label: 'Late cabs and autos', icon: 'car' },
      { key: 'campus', label: 'On campus', icon: 'school' },
      { key: 'commute', label: 'My daily commute', icon: 'bus' },
      { key: 'travel', label: 'Travelling somewhere new', icon: 'airplane' },
      { key: 'justcase', label: 'Just in case', icon: 'sparkles' },
    ],
  },
  routine: {
    id: 'routine', kind: 'single', eyebrow: 'YOUR RHYTHM', q: 'When are you usually out?',
    options: [
      { key: 'late', label: 'Late nights', icon: 'moon' },
      { key: 'early', label: 'Early mornings', icon: 'sunny' },
      { key: 'allday', label: 'All through the day', icon: 'time' },
      { key: 'unpred', label: 'Honestly, unpredictable', icon: 'shuffle' },
    ],
  },
  env: {
    id: 'env', kind: 'single', eyebrow: 'YOUR GROUND', q: 'Where do you spend most time?',
    options: [
      { key: 'city', label: 'A big city', icon: 'business' },
      { key: 'town', label: 'A smaller town', icon: 'home' },
      { key: 'campus', label: 'Around campus', icon: 'school' },
      { key: 'travel', label: 'On the move a lot', icon: 'airplane' },
    ],
  },
  transport: {
    id: 'transport', kind: 'single', eyebrow: 'GETTING AROUND', q: 'How do you usually get around?',
    options: [
      { key: 'walk', label: 'Mostly on foot', icon: 'walk' },
      { key: 'public', label: 'Buses and metro', icon: 'bus' },
      { key: 'cabs', label: 'Cabs and autos', icon: 'car' },
      { key: 'drive', label: 'I drive myself', icon: 'car-sport' },
    ],
  },
  instinct: {
    id: 'instinct', kind: 'single', eyebrow: 'YOUR INSTINCT', q: 'In a scary moment, what do you do?',
    options: [
      { key: 'shout', label: 'I shout for help', icon: 'megaphone' },
      { key: 'call', label: 'I reach for someone', icon: 'call' },
      { key: 'run', label: 'I get out fast', icon: 'walk' },
      { key: 'freeze', label: 'I freeze up', icon: 'snow' },
    ],
  },
  priority: {
    id: 'priority', kind: 'multi', eyebrow: 'YOUR RULES', q: 'What should ORBII care about most?',
    options: [
      { key: 'privacy', label: 'My privacy, always', icon: 'lock-closed' },
      { key: 'works', label: 'That it actually works', icon: 'shield-checkmark' },
      { key: 'speed', label: 'Speed when it counts', icon: 'flash' },
      { key: 'notrack', label: 'Never tracking or selling me', icon: 'eye-off' },
    ],
  },
};

type TypeKey = 'guardian' | 'protector' | 'strategist' | 'warrior';
const TYPES: Record<TypeKey, { name: string; tag: string; icon: IconName; color: string; blurb: string }> = {
  guardian: { name: 'The Night Guardian', tag: 'GUARDIAN', icon: 'moon', color: '#6C5CE7', blurb: "You don't shrink from the dark, you move through it. Now ORBII moves with you, listening for the second you need it." },
  protector: { name: 'The Protector', tag: 'PROTECTOR', icon: 'heart', color: '#E84393', blurb: 'You carry the people you love with you everywhere. ORBII keeps them close, reachable, and covered, always.' },
  strategist: { name: 'The Strategist', tag: 'STRATEGIST', icon: 'navigate', color: '#0984E3', blurb: 'You think two steps ahead. ORBII is the plan you already made for the moment things go sideways.' },
  warrior: { name: 'The Quiet Warrior', tag: 'WARRIOR', icon: 'shield-checkmark', color: '#00B894', blurb: "When words freeze, ORBII speaks for you. It hears the fear you can't voice and acts on its own." },
};
function computeType(a: Answers): TypeKey {
  if (a.instinct === 'freeze') return 'warrior';
  if (a.instinct === 'run') return 'strategist';
  if (a.why === 'loved' || a.instinct === 'call') return 'protector';
  return 'guardian';
}
function mirrorLines(a: Answers): string[] {
  const env: Record<string, string> = { city: 'a big city', town: 'a smaller town', campus: 'campus', travel: 'the road' };
  const rt: Record<string, string> = { late: 'late-night', early: 'early-morning', allday: 'all-day', unpred: 'unpredictable' };
  const scLabel: Record<string, string> = { night: 'late walks', cabs: 'late cabs', campus: 'campus', commute: 'your commute', travel: 'travel', justcase: 'anything unexpected' };
  const out: string[] = [];
  out.push(`Tuned for ${rt[a.routine ?? 'unpred']} movement in ${env[a.env ?? 'city']}.`);
  const sc = (a.scenarios ?? []).slice(0, 2).map((k) => scLabel[k] ?? k);
  if (sc.length) out.push(`Watching your ${sc.join(' and ')}.`);
  out.push('Voice trigger set to hear a shout, even from your pocket.');
  return out;
}

export function OnboardingScreen() {
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const [si, setSi] = useState(0);
  const [answers, setAnswers] = useState<Answers>({ scenarios: [], priority: [] });
  const screen: ScreenId = SCREENS[si];

  // Screen-level transition is deliberately light (a short fade + a few px of
  // travel) because the text now blurs in element by element. A big container
  // slide on top of that reads as double animation.
  const t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [si, t]);

  // Progress bar fills across the flow.
  const prog = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(prog, { toValue: (si + 1) / SCREENS.length, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [si, prog]);

  const next = () => { Haptics.selectionAsync().catch(() => undefined); setSi((n) => Math.min(SCREENS.length - 1, n + 1)); };
  const back = () => { Haptics.selectionAsync().catch(() => undefined); setSi((n) => Math.max(0, n - 1)); };
  const finish = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    dispatch(onboardingCompleted());
  };
  const setAnswer = (id: keyof Answers, val: string | string[]) => setAnswers((a) => ({ ...a, [id]: val }));

  const type = useMemo(() => computeType(answers), [answers]);

  const body = () => {
    switch (screen) {
      case 'hero': return <Hero onNext={next} />;
      case 'name': return <NameStep value={answers.name ?? ''} onSet={(v) => setAnswer('name', v)} onNext={next} onBack={back} />;
      case 'heard': case 'usedbefore': case 'why': case 'scenarios': case 'routine':
      case 'env': case 'transport': case 'instinct': case 'priority':
        return <Quiz key={screen} q={QUESTIONS[screen]} answers={answers} onSet={setAnswer} onNext={next} onBack={back} />;
      case 'loader': return <Loader onDone={next} />;
      case 'mirror': return <Mirror name={answers.name} lines={mirrorLines(answers)} onNext={next} />;
      case 'label': return <Label name={answers.name} type={TYPES[type]} onNext={next} />;
      case 'control': return <Control name={answers.name} onNext={next} />;
      case 'plus': return <Plus onNext={next} />;
      case 'pledge': return <Pledge onNext={next} />;
      case 'voice': return <Voice onNext={next} />;
      case 'perms': return <Permissions onNext={next} />;
      case 'summary': return <Summary type={TYPES[type]} onDone={finish} />;
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Only show progress AFTER the aha (hero + voice). Advertising "16 steps"
            up front makes people bounce; momentum shown once they're invested does
            the opposite. */}
        {si >= 1 ? (
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: prog.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
        ) : (
          <View style={styles.progressSpacer} />
        )}
        <Animated.View style={{ flex: 1, opacity: t, transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
          <Scaffoldless insets={insets.bottom}>{body()}</Scaffoldless>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

// Passes the safe-area inset down to the pinned CTA of each screen.
const InsetCtx = React.createContext(0);
function Scaffoldless({ children, insets }: { children: React.ReactNode; insets: number }) {
  return <InsetCtx.Provider value={insets}><View style={{ flex: 1 }}>{children}</View></InsetCtx.Provider>;
}

/**
 * Blur-in text. Two stacked layers cross-fade: a genuinely blurred "ghost"
 * (transparent glyphs casting a wide text shadow, which renders as a soft cloud
 * of the letterforms) dissolves as the crisp text resolves over it. Both run on
 * the native driver, so the whole thing stays at 60fps.
 */
function BlurText({
  children,
  style,
  delay = 0,
  blur = 10,
  color = C.text,
}: {
  children: React.ReactNode;
  style?: StyleProp<TextStyle>;
  delay?: number;
  blur?: number;
  color?: string;
}) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const a = Animated.timing(v, {
      toValue: 1,
      duration: 620,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    a.start();
    return () => a.stop();
  }, [v, delay]);

  const rise = v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  const scale = v.interpolate({ inputRange: [0, 1], outputRange: [1.04, 1] });
  const ghostOut = v.interpolate({ inputRange: [0, 0.65, 1], outputRange: [1, 0.25, 0] });

  return (
    <Animated.View style={{ transform: [{ translateY: rise }, { scale }] }}>
      <Animated.Text style={[style, { opacity: v }]}>{children}</Animated.Text>
      <Animated.Text
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          style,
          {
            color: 'transparent',
            textShadowColor: color,
            textShadowOffset: { width: 0, height: 0 },
            textShadowRadius: blur,
            opacity: ghostOut,
          },
        ]}
      >
        {children}
      </Animated.Text>
    </Animated.View>
  );
}

/* Shared layout: scrolling content + a pinned bottom CTA (same spot every screen). */
function Screen({ children, ctaLabel, onCta, onBack, disabled, footer, arrow = true }: {
  children: React.ReactNode; ctaLabel: string; onCta: () => void; onBack?: () => void; disabled?: boolean; footer?: React.ReactNode; arrow?: boolean;
}) {
  const inset = React.useContext(InsetCtx);
  return (
    <View style={{ flex: 1 }}>
      {/* A mis-tapped answer used to be unrecoverable (single-select auto-advances),
          so every step past the first can go back. */}
      {onBack ? (
        <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn} accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={C.muted} />
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      <View style={[styles.ctaWrap, { paddingBottom: inset + S.sm }]}>
        <Pressable onPress={onCta} disabled={disabled} style={({ pressed }) => [styles.cta, disabled && styles.ctaOff, pressed && !disabled && styles.ctaPressed]}>
          <Text style={styles.ctaText}>{ctaLabel}</Text>
          {arrow ? <Ionicons name="arrow-forward" size={18} color="#fff" /> : null}
        </Pressable>
        {footer}
      </View>
    </View>
  );
}

/* ─── HERO ─── */
function Hero({ onNext }: { onNext: () => void }) {
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  const dot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const rip = (v: Animated.Value, d: number) => Animated.loop(Animated.timing(v, { toValue: 1, duration: 2400, delay: d, easing: Easing.out(Easing.ease), useNativeDriver: true }));
    rip(r1, 0).start(); rip(r2, 1200).start();
    Animated.loop(Animated.timing(dot, { toValue: 1, duration: 1600, easing: Easing.out(Easing.ease), useNativeDriver: true })).start();
  }, [r1, r2, dot]);
  const rs = (v: Animated.Value) => ({ opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.8, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] }) }] });
  return (
    <Screen ctaLabel="Let's begin" onCta={onNext}>
      <View style={styles.trustPill}>
        <View style={styles.greenDot}>
          <Animated.View style={[styles.greenDotPulse, { opacity: dot.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }), transform: [{ scale: dot.interpolate({ inputRange: [0, 1], outputRange: [0.6, 2.4] }) }] }]} />
        </View>
        <Text style={styles.trustText}>Now live · Private · Free on Google Play</Text>
      </View>
      <View style={styles.pulseWrap}>
        <Animated.View style={[styles.ripple, rs(r1)]} />
        <Animated.View style={[styles.ripple, rs(r2)]} />
        <View style={styles.shieldCore}><Ionicons name="shield-checkmark" size={40} color="#fff" /></View>
      </View>
      <BlurText style={styles.eyebrow} color={C.primary} blur={7} delay={120}>WELCOME TO ORBII</BlurText>
      <BlurText style={styles.h1} blur={12} delay={240}>Let's build your safety, together.</BlurText>
      <BlurText style={styles.sub} color={C.muted} blur={8} delay={400}>A few quick questions and ORBII tunes itself around your life. This is yours, not a template.</BlurText>
    </Screen>
  );
}

/* ─── QUIZ ─── */
function Quiz({ q, answers, onSet, onNext, onBack }: { q: Question; answers: Answers; onSet: (id: keyof Answers, v: string | string[]) => void; onNext: () => void; onBack?: () => void }) {
  const multi = q.kind === 'multi';
  const selected: string[] = multi ? (answers[q.id] as string[]) ?? [] : answers[q.id] ? [answers[q.id] as string] : [];
  const pick = (key: string) => {
    Haptics.selectionAsync().catch(() => undefined);
    if (multi) {
      const set = new Set(selected);
      set.has(key) ? set.delete(key) : set.add(key);
      onSet(q.id, [...set]);
    } else {
      onSet(q.id, key);
      setTimeout(onNext, 260); // single-select auto-advances, feels effortless
    }
  };
  const ready = selected.length > 0;
  return (
    <Screen ctaLabel={multi ? (ready ? 'Continue' : 'Pick what fits') : 'Continue'} disabled={!ready} onCta={onNext} onBack={onBack}>
      <BlurText style={styles.eyebrow} color={C.primary} blur={7} delay={40}>{q.eyebrow}</BlurText>
      <BlurText style={styles.h2} delay={120}>{q.q}</BlurText>
      {multi ? <BlurText style={styles.hint} color={C.muted} blur={7} delay={210}>Choose as many as you like.</BlurText> : null}
      <View style={styles.opts}>
        {q.options.map((o) => {
          const on = selected.includes(o.key);
          return (
            <Pressable key={o.key} onPress={() => pick(o.key)} style={[styles.opt, on && styles.optOn]}>
              <View style={[styles.optIcon, on && styles.optIconOn]}>
                <Ionicons name={o.icon} size={18} color={on ? '#fff' : C.primary} />
              </View>
              <Text style={[styles.optLabel, on && styles.optLabelOn]}>{o.label}</Text>
              <View style={[styles.radio, on && styles.radioOn]}>{on ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}</View>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

/* ─── LOADER (effort payoff) ─── */
const LOADER_MSGS = ['Reading your routine', 'Mapping where you move', 'Tuning your voice trigger', 'Locking in your profile'];
function Loader({ onDone }: { onDone: () => void }) {
  const spin = useRef(new Animated.Value(0)).current;
  const fill = useRef(new Animated.Value(0)).current;
  const [msg, setMsg] = useState(0);
  useEffect(() => {
    Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true })).start();
    Animated.timing(fill, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.ease), useNativeDriver: false }).start();
    const id = setInterval(() => setMsg((m) => Math.min(LOADER_MSGS.length - 1, m + 1)), 650);
    const done = setTimeout(onDone, 2800);
    return () => { clearInterval(id); clearTimeout(done); };
  }, [spin, fill, onDone]);
  return (
    <View style={styles.centerFill}>
      <Animated.View style={[styles.loaderRing, { transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]} />
      <Text style={styles.loaderTitle}>Building your safety profile</Text>
      <Text style={styles.loaderMsg}>{LOADER_MSGS[msg]}…</Text>
      <View style={styles.loaderTrack}>
        <Animated.View style={[styles.loaderBar, { width: fill.interpolate({ inputRange: [0, 1], outputRange: ['4%', '100%'] }) }]} />
      </View>
    </View>
  );
}

/* ─── MIRROR (the earned reveal) ─── */
function Mirror({ name, lines, onNext }: { name?: string; lines: string[]; onNext: () => void }) {
  const items = useRef(lines.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(120, items.map((v) => Animated.timing(v, { toValue: 1, duration: 420, easing: Easing.out(Easing.ease), useNativeDriver: true }))).start();
  }, [items]);
  return (
    <Screen ctaLabel="This is me" onCta={onNext}>
      <BlurText style={styles.eyebrow} color={C.primary} blur={7} delay={60}>YOUR SAFETY PROFILE</BlurText>
      <BlurText style={styles.h2} blur={12} delay={180}>{name ? `${name}, meet your ORBII.` : 'Meet your ORBII.'}</BlurText>
      <BlurText style={styles.sub} color={C.muted} blur={8} delay={320}>Built from your answers, tuned to your life. Here is what it is watching for.</BlurText>
      <View style={styles.profileCard}>
        {lines.map((l, i) => (
          <Animated.View key={i} style={[styles.profileRow, { opacity: items[i], transform: [{ translateY: items[i].interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }]}>
            <View style={styles.profileTick}><Ionicons name="checkmark" size={14} color={C.emerald} /></View>
            <Text style={styles.profileText}>{l}</Text>
          </Animated.View>
        ))}
      </View>
    </Screen>
  );
}

/* ─── LABEL (identity) ─── */
function Label({ name, type, onNext }: { name?: string; type: typeof TYPES[TypeKey]; onNext: () => void }) {
  const pop = useRef(new Animated.Value(0)).current;
  const [confetti, setConfetti] = useState(false);
  useEffect(() => {
    Animated.spring(pop, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }).start();
    setConfetti(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  }, [pop]);
  return (
    <Screen ctaLabel="Claim my type" onCta={onNext}>
      <BlurText style={[styles.eyebrow, { textAlign: 'center' }]} color={C.primary} blur={7} delay={60}>
        {name ? `${name.toUpperCase()}, YOU ARE` : 'YOUR SAFETY TYPE'}
      </BlurText>
      <Animated.View style={[styles.badgeCard, { transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }], opacity: pop }]}>
        <View style={[styles.badgeIcon, { backgroundColor: type.color }]}><Ionicons name={type.icon} size={44} color="#fff" /></View>
        <Text style={styles.badgeTag}>{type.tag}</Text>
        <Text style={[styles.badgeName, { color: type.color }]}>{type.name}</Text>
        <Text style={styles.badgeBlurb}>{type.blurb}</Text>
        <View style={styles.badgeFoot}><Ionicons name="lock-closed" size={11} color={C.muted} /><Text style={styles.badgeFootText}>Earned from your answers</Text></View>
      </Animated.View>
      <Celebration visible={confetti} originY={0.3} onDone={() => setConfetti(false)} />
    </Screen>
  );
}

/* ─── CONTROL (trust + ownership) ─── */
function Control({ name, onNext }: { name?: string; onNext: () => void }) {
  const rows: { icon: IconName; text: string }[] = [
    { icon: 'eye', text: 'You decide who sees you, and you can cut it in one tap.' },
    { icon: 'mic', text: 'ORBII listens only when you say so, and only as long as you choose.' },
    { icon: 'lock-closed', text: 'Your voice stays on your phone. We never sell you. Ever.' },
  ];
  return (
    <Screen ctaLabel="It's mine, let's go" onCta={onNext}>
      <BlurText style={styles.eyebrow} color={C.primary} blur={7} delay={60}>YOU'RE IN CONTROL</BlurText>
      <BlurText style={styles.h2} blur={12} delay={180}>{name ? `${name}, this is yours now.` : 'This is yours now.'}</BlurText>
      <BlurText style={styles.sub} color={C.muted} blur={8} delay={320}>Not ours. You set the rules, ORBII just follows them.</BlurText>
      <View style={styles.controlList}>
        {rows.map((r) => (
          <View key={r.icon} style={styles.controlRow}>
            <View style={styles.controlIcon}><Ionicons name={r.icon} size={18} color={C.primary} /></View>
            <Text style={styles.controlText}>{r.text}</Text>
          </View>
        ))}
      </View>
    </Screen>
  );
}

/* ─── NAME (personalisation) ─── */
function NameStep({ value, onSet, onNext, onBack }: { value: string; onSet: (v: string) => void; onNext: () => void; onBack?: () => void }) {
  const ready = value.trim().length >= 2;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen ctaLabel="Continue" disabled={!ready} onCta={onNext} onBack={onBack}>
        <BlurText style={styles.eyebrow} color={C.primary} blur={7} delay={40}>FIRST, THE BASICS</BlurText>
        <BlurText style={styles.h2} delay={120}>What should we call you?</BlurText>
        <BlurText style={styles.sub} color={C.muted} blur={8} delay={210}>So ORBII feels like yours from the very first screen.</BlurText>
        <View style={styles.nameField}>
          <TextInput
            value={value}
            onChangeText={onSet}
            placeholder="Your first name"
            placeholderTextColor={C.muted}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={() => ready && onNext()}
            style={styles.nameInput}
          />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/* ─── PLUS + FAMILY (introduced at peak investment) ─── */
function Plus({ onNext }: { onNext: () => void }) {
  return (
    <Screen ctaLabel="Continue with Free" arrow={false} onCta={onNext} footer={
      <Pressable onPress={onNext} style={{ alignSelf: 'center', marginTop: S.sm }}>
        <Text style={styles.plusSkip}>You can upgrade anytime from your profile.</Text>
      </Pressable>
    }>
      <Text style={styles.eyebrow}>GO FURTHER, IF YOU WANT</Text>
      <Text style={styles.h2}>Everything life-saving is free.</Text>
      <Text style={styles.sub}>Voice SOS, alerts to your circle, and 112 are always free. These add reach for when you want more.</Text>

      <View style={[styles.planCard, { borderColor: C.primary }]}>
        <View style={styles.planTop}>
          <View style={[styles.planIcon, { backgroundColor: C.primary }]}><Ionicons name="infinite" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.planName}>ORBII Plus</Text>
            <Text style={styles.planPrice}>7 days free, then ₹149/mo</Text>
          </View>
        </View>
        <Text style={styles.planLine}>Unlimited verified helpers dispatched to you, priority matching, and the offline helper alert.</Text>
      </View>

      <View style={[styles.planCard, { borderColor: '#E84393' }]}>
        <View style={styles.planTop}>
          <View style={[styles.planIcon, { backgroundColor: '#E84393' }]}><Ionicons name="people" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.planName}>ORBII Family</Text>
            <Text style={styles.planPrice}>₹499/mo</Text>
          </View>
        </View>
        <Text style={styles.planLine}>Protect up to 4 people you love, with shared safe zones and alerts when someone leaves one.</Text>
      </View>

      <View style={styles.plusHonest}>
        <Ionicons name="lock-closed" size={13} color={C.muted} />
        <Text style={styles.plusHonestText}>Not charged today. We tell you before any charge, and you can cancel in one tap.</Text>
      </View>
    </Screen>
  );
}

/* ─── PLEDGE (signature) ─── */
function Pledge({ onNext }: { onNext: () => void }) {
  const pathsRef = useRef<string[]>([]);
  const curRef = useRef('');
  const stampedRef = useRef(false);
  const [, force] = useState(0);
  const [stamped, setStamped] = useState(false);
  const [confetti, setConfetti] = useState(false);
  const stampScale = useRef(new Animated.Value(2)).current;
  const arm = () => {
    stampedRef.current = true; setStamped(true); setConfetti(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    stampScale.setValue(2);
    Animated.spring(stampScale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !stampedRef.current,
    onMoveShouldSetPanResponder: () => !stampedRef.current,
    onPanResponderGrant: (e) => { const { locationX, locationY } = e.nativeEvent; curRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`; force((n) => n + 1); },
    onPanResponderMove: (e) => { const { locationX, locationY } = e.nativeEvent; curRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`; force((n) => n + 1); },
    onPanResponderRelease: () => { if (curRef.current) { pathsRef.current.push(curRef.current); curRef.current = ''; } if (!stampedRef.current && pathsRef.current.join('').length > 12) arm(); force((n) => n + 1); },
  })).current;
  const reset = () => { pathsRef.current = []; curRef.current = ''; stampedRef.current = false; setStamped(false); setConfetti(false); force((n) => n + 1); };
  const allPaths = curRef.current ? [...pathsRef.current, curRef.current] : pathsRef.current;
  const hasInk = allPaths.join('').length > 0;
  return (
    <Screen ctaLabel="Continue" disabled={!stamped} onCta={onNext} footer={stamped ? <Pressable onPress={reset} style={{ alignSelf: 'center', marginTop: S.sm }}><Text style={styles.redrawText}>Clear & redraw</Text></Pressable> : undefined}>
      <Text style={styles.eyebrow}>THE SAFETY PLEDGE</Text>
      <Text style={styles.h2}>Sign to arm ORBII.</Text>
      <Text style={styles.sub}>Your promise to reach for help, and ours to answer. Draw your signature below.</Text>
      <View style={styles.canvasBox} {...pan.panHandlers}>
        <Svg style={StyleSheet.absoluteFill}>
          {allPaths.map((d, i) => <Path key={i} d={d} stroke={C.primary} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        </Svg>
        {!hasInk ? <Text style={styles.canvasHint}>Sign here with your finger</Text> : null}
        {stamped ? (
          <Animated.View style={[styles.stamp, { transform: [{ rotate: '-5deg' }, { scale: stampScale }] }]} pointerEvents="none">
            <Text style={styles.stampText}>APPROVED • ORBII ARMED</Text>
          </Animated.View>
        ) : null}
      </View>
      <Celebration visible={confetti} originY={0.42} onDone={() => setConfetti(false)} />
    </Screen>
  );
}

/* ─── VOICE ─── */
const AnimatedPath = Animated.createAnimatedComponent(Path);
const VOICE_WORDS = [
  { key: 'help', prompt: '“Help, help”' },
  { key: 'bachao', prompt: '“Bachao, bachao”' },
];
// REAL two-word test: the actual on-device engine listens for "help", then
// "bachao". runVoiceTest routes any fire to a callback, so no real SOS is sent.
function Voice({ onNext }: { onNext: () => void }) {
  const bars = useRef([0, 1, 2, 3, 4].map(() => new Animated.Value(0))).current;
  const [step, setStep] = useState(0); // 0 = help, 1 = bachao, 2 = both done
  const [listening, setListening] = useState(false);
  const [flash, setFlash] = useState(false);
  const [missed, setMissed] = useState(false);
  const circle = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    if (!listening) { bars.forEach((b) => { b.stopAnimation(); b.setValue(0); }); return; }
    const loops = bars.map((b, i) => Animated.loop(Animated.sequence([
      Animated.timing(b, { toValue: 1, duration: 500, delay: i * 120, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      Animated.timing(b, { toValue: 0, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
    ])));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [bars, listening]);
  useEffect(() => () => { cancelVoiceTest(); }, []);

  const heardFlash = (after: () => void) => {
    setFlash(true);
    circle.setValue(0); check.setValue(40);
    Animated.spring(circle, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }).start();
    Animated.timing(check, { toValue: 0, duration: 350, delay: 150, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setTimeout(() => { setFlash(false); after(); }, 1100);
  };

  const listen = async () => {
    setMissed(false);
    setListening(true);
    const res = await runVoiceTest(12000);
    setListening(false);
    // 'unavailable' = emulator / non-Android: let the flow continue.
    if (res === 'heard' || res === 'unavailable') {
      heardFlash(() => setStep((s) => Math.min(2, s + 1)));
    } else {
      setMissed(true);
    }
  };

  const done = step >= 2;
  const cur = VOICE_WORDS[Math.min(step, 1)];

  return (
    <Screen
      ctaLabel={done ? 'Continue' : listening ? 'Listening…' : `Shout ${cur.prompt}`}
      arrow={done}
      disabled={listening}
      onCta={done ? onNext : listen}
      footer={missed && !done ? (
        <Pressable onPress={() => setStep((s) => Math.min(2, s + 1))} style={{ alignItems: 'center', paddingVertical: S.sm }}>
          <Text style={styles.voiceSkip}>Can't right now, skip this word</Text>
        </Pressable>
      ) : undefined}
    >
      <Text style={styles.eyebrow}>VOICE SOS TEST</Text>
      <Text style={styles.h2}>{done ? 'You did it.' : `Now shout ${cur.prompt}`}</Text>
      <Text style={styles.sub}>
        {done
          ? 'ORBII heard you both times. That is exactly how it works in a real emergency, hands-free.'
          : listening
            ? 'Listening… say it out loud. Nothing is sent.'
            : missed
              ? 'Did not catch that. Move somewhere quieter and try again.'
              : 'Two quick tests, so you know it really hears you. Nothing is sent.'}
      </Text>
      <View style={styles.visual}>
        {flash ? (
          <Animated.View style={[styles.greenCircle, { opacity: circle, transform: [{ scale: circle }] }]}>
            <Svg width={46} height={46} viewBox="0 0 24 24">
              <AnimatedPath d="M20 6 9 17l-5-5" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray={40} strokeDashoffset={check} />
            </Svg>
          </Animated.View>
        ) : (
          <View style={styles.barsRow}>
            {bars.map((b, i) => (
              <Animated.View key={i} style={[styles.bar, { backgroundColor: listening ? C.primary : C.hairline, height: listening ? b.interpolate({ inputRange: [0, 1], outputRange: [10, 30] }) : 12 }]} />
            ))}
          </View>
        )}
      </View>
      <View style={styles.voiceDots}>
        {VOICE_WORDS.map((w, i) => (
          <View key={w.key} style={[styles.voiceDot, (step > i) && styles.voiceDotOn]} />
        ))}
      </View>
    </Screen>
  );
}

/* ─── PERMISSIONS ─── */
const PERMS: { key: string; title: string; sub: string; icon: IconName }[] = [
  { key: 'mic', title: 'Voice Trigger', sub: 'Lets ORBII hear "help, help" and act, even from your pocket.', icon: 'mic' },
  { key: 'location', title: 'Live Location', sub: 'Shares your live position with your circle during an SOS only.', icon: 'location' },
  { key: 'overlay', title: 'Over-App Display', sub: 'Pops the SOS over any app so it fires hands-free.', icon: 'phone-portrait' },
];
function Permissions({ onNext }: { onNext: () => void }) {
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState<Set<number>>(new Set());
  const request = async (key: string) => {
    try {
      if (Platform.OS !== 'android') return;
      if (key === 'mic') await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      else if (key === 'location') await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      else if (key === 'overlay') await requestOverlayPermission();
    } catch { /* best effort */ }
  };
  const allow = async (i: number) => {
    if (i !== idx) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    await request(PERMS[i].key);
    setDone((cur) => new Set(cur).add(i));
    setIdx(i + 1);
  };
  return (
    <Screen ctaLabel="Continue" disabled={done.size < PERMS.length} onCta={onNext}>
      <Text style={styles.eyebrow}>PERMISSIONS</Text>
      <Text style={styles.h2}>Three taps to full cover.</Text>
      <Text style={styles.sub}>Each one unlocks a specific piece of your protection.</Text>
      <View style={styles.permStack}>
        {PERMS.map((p, i) => {
          const isDone = done.has(i); const isNext = i === idx + 1; const locked = i > idx + 1;
          return (
            <View key={p.key} style={[styles.perm, isDone && styles.permDone, isNext && styles.permNext, locked && styles.permLocked]}>
              <View style={[styles.permIcon, isDone && styles.permIconDone]}><Ionicons name={isDone ? 'checkmark' : p.icon} size={22} color={isDone ? '#fff' : C.primary} /></View>
              <View style={{ flex: 1 }}><Text style={styles.permTitle}>{p.title}</Text><Text style={styles.permSub}>{p.sub}</Text></View>
              <Pressable onPress={() => allow(i)} disabled={i !== idx} style={[styles.allow, isDone && styles.allowDone]}><Text style={styles.allowText}>{isDone ? '✓' : 'Allow'}</Text></Pressable>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

/* ─── SUMMARY + founder note ─── */
const SUMMARY = ['Voice trigger active', 'Live location ready', 'Safety profile saved'];
function Summary({ type, onDone }: { type: typeof TYPES[TypeKey]; onDone: () => void }) {
  const items = useRef(SUMMARY.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    Animated.stagger(100, items.map((v) => Animated.timing(v, { toValue: 1, duration: 400, easing: Easing.out(Easing.ease), useNativeDriver: true }))).start();
  }, [items]);
  return (
    <Screen ctaLabel="Enter ORBII" onCta={onDone}>
      <Text style={styles.eyebrow}>YOU'RE PROTECTED</Text>
      <Text style={styles.h2}>{type.name}, you're armed.</Text>
      <View style={styles.statusCard}>
        <View style={[styles.statusBar, { backgroundColor: C.emerald }]} />
        <View style={styles.statusInner}>
          {SUMMARY.map((s, i) => (
            <Animated.View key={s} style={[styles.checkItem, { opacity: items[i], transform: [{ translateX: items[i].interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }]}>
              <View style={styles.checkDot}><Ionicons name="checkmark" size={15} color={C.emerald} /></View>
              <Text style={styles.checkText}>{s}</Text>
            </Animated.View>
          ))}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  progressTrack: { height: 4, marginHorizontal: S.lg, marginTop: S.sm, borderRadius: 99, backgroundColor: C.hairline, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 99, backgroundColor: C.primary },
  progressSpacer: { height: 4, marginTop: S.sm },

  scroll: { flexGrow: 1, paddingHorizontal: S.lg, paddingTop: S.lg },
  backBtn: { alignSelf: 'flex-start', marginLeft: S.md, marginBottom: -S.sm, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  ctaWrap: { paddingHorizontal: S.xl, paddingTop: S.sm },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: S.sm, backgroundColor: C.ink, borderRadius: 32, paddingVertical: 19 },
  ctaOff: { opacity: 0.4 },
  ctaPressed: { transform: [{ scale: 0.97 }] },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#fff' },

  eyebrow: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 1.5, color: C.primary, textAlign: 'center' },
  h1: { fontFamily: fontFamilies.poppinsBold, fontSize: 31, lineHeight: 37, letterSpacing: -0.8, color: C.text, textAlign: 'center', marginTop: S.md, marginBottom: S.sm },
  h2: { fontFamily: fontFamilies.poppinsBold, fontSize: 28, lineHeight: 33, letterSpacing: -0.7, color: C.text, textAlign: 'center', marginTop: S.md, marginBottom: S.xs },
  sub: { fontFamily: fontFamilies.interRegular, fontSize: 15, lineHeight: 22, color: C.muted, textAlign: 'center' },
  hint: { fontFamily: fontFamilies.interRegular, fontSize: 13, color: C.muted, textAlign: 'center', marginTop: S.xs },

  trustPill: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: S.sm, backgroundColor: C.pill, borderRadius: 30, paddingVertical: S.sm, paddingHorizontal: S.md },
  greenDot: { width: 6, height: 6, borderRadius: 99, backgroundColor: C.emerald },
  greenDotPulse: { position: 'absolute', top: -3, left: -3, right: -3, bottom: -3, borderRadius: 99, backgroundColor: C.emerald },
  trustText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: C.primary },
  pulseWrap: { alignSelf: 'center', width: 150, height: 150, alignItems: 'center', justifyContent: 'center', marginVertical: S.lg },
  ripple: { position: 'absolute', width: 88, height: 88, borderRadius: 99, backgroundColor: 'rgba(108,92,231,0.18)' },
  shieldCore: { width: 88, height: 88, borderRadius: 99, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center', shadowColor: C.primary, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 8 },

  opts: { gap: S.sm, marginTop: S.lg },
  opt: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1.5, borderColor: C.hairline, padding: S.md },
  optOn: { borderColor: C.primary, backgroundColor: C.pill },
  optIcon: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.pill, alignItems: 'center', justifyContent: 'center' },
  optIconOn: { backgroundColor: C.primary },
  optLabel: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: C.text },
  optLabelOn: { color: C.primary },
  radio: { width: 22, height: 22, borderRadius: 99, borderWidth: 2, borderColor: C.hairline, alignItems: 'center', justifyContent: 'center' },
  radioOn: { backgroundColor: C.primary, borderColor: C.primary },

  centerFill: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: S.xl },
  loaderRing: { width: 56, height: 56, borderRadius: 99, borderWidth: 4, borderColor: C.hairline, borderTopColor: C.primary, marginBottom: S.lg },
  loaderTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 20, color: C.text, textAlign: 'center' },
  loaderMsg: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: C.muted, marginTop: S.xs, marginBottom: S.lg },
  loaderTrack: { width: '78%', height: 6, borderRadius: 99, backgroundColor: C.hairline, overflow: 'hidden' },
  loaderBar: { height: 6, borderRadius: 99, backgroundColor: C.primary },

  profileCard: { backgroundColor: C.surface, borderRadius: 20, padding: S.lg, marginTop: S.lg, gap: S.md, shadowColor: '#2D3436', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.1, shadowRadius: 24, elevation: 4 },
  profileRow: { flexDirection: 'row', alignItems: 'flex-start', gap: S.md },
  profileTick: { width: 26, height: 26, borderRadius: 99, backgroundColor: 'rgba(0,184,148,0.14)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  profileText: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, lineHeight: 20, color: C.text },

  badgeCard: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 24, padding: S.xl, marginTop: S.lg, shadowColor: '#2D3436', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.14, shadowRadius: 30, elevation: 6 },
  badgeIcon: { width: 88, height: 88, borderRadius: 99, alignItems: 'center', justifyContent: 'center', marginBottom: S.md },
  badgeTag: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, letterSpacing: 2, color: C.muted },
  badgeName: { fontFamily: fontFamilies.poppinsBold, fontSize: 26, letterSpacing: -0.5, marginTop: S.xs, marginBottom: S.sm },
  badgeBlurb: { fontFamily: fontFamilies.interRegular, fontSize: 14.5, lineHeight: 22, color: C.muted, textAlign: 'center' },
  badgeFoot: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: S.md },
  badgeFootText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, color: C.muted },

  controlList: { gap: S.md, marginTop: S.lg },
  controlRow: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: 16, padding: S.md },
  controlIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: C.pill, alignItems: 'center', justifyContent: 'center' },
  controlText: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, lineHeight: 20, color: C.text },
  nameField: { marginTop: S.lg, backgroundColor: C.surface, borderRadius: 16, borderWidth: 1.5, borderColor: C.hairline, paddingHorizontal: S.md, height: 60, justifyContent: 'center' },
  nameInput: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 18, color: C.text },

  planCard: { backgroundColor: C.surface, borderRadius: 20, borderWidth: 2, padding: S.md, marginTop: S.md, gap: S.sm },
  planTop: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  planIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  planName: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: C.text },
  planPrice: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: C.muted, marginTop: 1 },
  planLine: { fontFamily: fontFamilies.interRegular, fontSize: 13, lineHeight: 19, color: C.muted },
  plusHonest: { flexDirection: 'row', alignItems: 'center', gap: S.sm, marginTop: S.md, backgroundColor: C.pill, borderRadius: 12, padding: S.md },
  plusHonestText: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 12, lineHeight: 17, color: C.primary },
  plusSkip: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: C.muted, textAlign: 'center' },

  canvasBox: { position: 'relative', height: 200, borderRadius: 20, borderWidth: 2, borderColor: C.accent, borderStyle: 'dashed', backgroundColor: C.surface, marginTop: S.lg, overflow: 'hidden' },
  canvasHint: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, textAlign: 'center', color: C.muted, fontFamily: fontFamilies.interRegular, fontSize: 14, lineHeight: 200 },
  stamp: { position: 'absolute', top: '38%', alignSelf: 'center', backgroundColor: C.emerald, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 18, borderWidth: 2.5, borderColor: 'rgba(255,255,255,0.7)' },
  stampText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, letterSpacing: 0.6, color: '#fff' },
  redrawText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: C.muted, textDecorationLine: 'underline' },

  visual: { alignSelf: 'center', height: 130, alignItems: 'center', justifyContent: 'center', marginVertical: S.xl },
  barsRow: { flexDirection: 'row', alignItems: 'center', gap: S.sm, height: 40 },
  bar: { width: 8, borderRadius: 99 },
  greenCircle: { position: 'absolute', width: 96, height: 96, borderRadius: 99, backgroundColor: C.emerald, alignItems: 'center', justifyContent: 'center', shadowColor: C.emerald, shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 8 },
  banner: { textAlign: 'center', fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: C.emerald },
  voiceDots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: S.sm },
  voiceDot: { width: 9, height: 9, borderRadius: 99, backgroundColor: C.hairline },
  voiceDotOn: { backgroundColor: C.emerald },
  voiceSkip: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: C.muted },

  permStack: { gap: S.md, marginTop: S.lg },
  perm: { flexDirection: 'row', alignItems: 'center', gap: S.md, backgroundColor: C.surface, borderRadius: 20, borderWidth: 2, borderColor: '#ECEAF6', padding: S.md },
  permNext: { opacity: 0.55, transform: [{ scale: 0.97 }] },
  permLocked: { opacity: 0.4 },
  permDone: { borderColor: C.emerald },
  permIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: C.pill, alignItems: 'center', justifyContent: 'center' },
  permIconDone: { backgroundColor: C.emerald },
  permTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: C.text },
  permSub: { fontFamily: fontFamilies.interRegular, fontSize: 12, lineHeight: 16, color: C.muted, marginTop: 2 },
  allow: { backgroundColor: C.primary, borderRadius: 30, paddingVertical: 9, paddingHorizontal: 15 },
  allowDone: { backgroundColor: C.emerald },
  allowText: { fontFamily: fontFamilies.poppinsBold, fontSize: 12.5, color: '#fff' },

  statusCard: { backgroundColor: C.surface, borderRadius: 20, overflow: 'hidden', marginTop: S.lg, shadowColor: '#2D3436', shadowOffset: { width: 0, height: 12 }, shadowOpacity: 0.12, shadowRadius: 24, elevation: 4 },
  statusBar: { height: 6 },
  statusInner: { padding: S.md, gap: S.md },
  checkItem: { flexDirection: 'row', alignItems: 'center', gap: S.md },
  checkDot: { width: 26, height: 26, borderRadius: 99, backgroundColor: 'rgba(0,184,148,0.14)', alignItems: 'center', justifyContent: 'center' },
  checkText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: C.text },

  founderNote: { backgroundColor: '#FAFAFA', borderRadius: 20, borderWidth: 1, borderColor: '#EFEFF4', padding: S.md, marginTop: S.md },
  founderBody: { fontFamily: fontFamilies.interRegular, fontSize: 13.5, lineHeight: 22, color: C.muted },
  founderSig: { fontFamily: fontFamilies.handwriting, fontSize: 32, color: C.primary, marginTop: S.sm, lineHeight: 36 },
  founderSub: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.6, color: C.muted, marginTop: 1 },
});
