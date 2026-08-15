import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { appAlert, Celebration } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { getItem, setItem } from '@/services/storage';
import { hasDonationConsent, setDonationConsent, uploadVoiceSample } from '@/services/voice-donation';
import { setSosSuppressed } from '@/services/voice-test';

// "Voice Quests", a gamified, opt-in voice-donation game. Each round you're
// dealt TWO missions ("shout bachao in a crowd", "say help in a silent room")
// and pick one to record. You earn XP, keep a streak, and unlock badges. Reward
// is status only (XP/badges), never coins, because paying for clips would invite
// exactly the junk data we defend against.

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const WORDS = [
  { phrase: 'help', lang: 'en', say: '“Help, help”' },
  { phrase: 'bachao', lang: 'hi', say: '“Bachao, bachao”' },
  { phrase: 'madad', lang: 'hi', say: '“Madad karo”' },
  { phrase: 'save me', lang: 'en', say: '“Save me”' },
];
const CONTEXTS: { key: string; label: string; icon: IconName }[] = [
  { key: 'silent', label: 'in a silent room', icon: 'moon' },
  { key: 'car', label: 'in a quiet car', icon: 'car' },
  { key: 'market', label: 'in a busy market', icon: 'storefront' },
  { key: 'station', label: 'at a bus or train station', icon: 'train' },
  { key: 'crowd', label: 'in a crowd', icon: 'people' },
  { key: 'music', label: 'with music playing', icon: 'musical-notes' },
  { key: 'street', label: 'outside with some traffic', icon: 'trail-sign' },
  { key: 'cafe', label: 'in a cafe', icon: 'cafe' },
];
const TONES: { key: string; verb: string }[] = [
  { key: 'say', verb: 'Say' },
  { key: 'shout', verb: 'Shout' },
  { key: 'whisper', verb: 'Whisper' },
];
const ACCENTS = [colors.brand, colors.coral, colors.sage, colors.peachDeep];
const BADGES = [
  { n: 1, name: 'First Voice', icon: 'mic' as IconName },
  { n: 5, name: 'Warming Up', icon: 'flame' as IconName },
  { n: 15, name: 'Data Hero', icon: 'shield-checkmark' as IconName },
  { n: 30, name: 'ORBII Legend', icon: 'trophy' as IconName },
];

type Mission = { key: string; phrase: string; lang: string; instruction: string; ctxKey: string; uniq: string; icon: IconName; accent: string };
const ri = (n: number) => Math.floor(Math.random() * n);
function makeMission(i: number, excludeUniq?: string): Mission {
  let w = WORDS[0], c = CONTEXTS[0], t = TONES[0], uniq = '';
  for (let tries = 0; tries < 20; tries++) {
    w = WORDS[ri(WORDS.length)];
    c = CONTEXTS[ri(CONTEXTS.length)];
    t = TONES[ri(TONES.length)];
    uniq = `${t.key}-${c.key}-${w.phrase}`;
    if (uniq !== excludeUniq) break;
  }
  return {
    key: `${Date.now()}_${i}_${ri(1e9)}`,
    phrase: w.phrase, lang: w.lang,
    instruction: `${t.verb} ${w.say} ${c.label}`,
    ctxKey: `${t.key}-${c.key}`,
    uniq,
    icon: c.icon,
    accent: ACCENTS[i % ACCENTS.length],
  };
}
// Two DISTINCT missions each round (never the same word+context+tone).
function makePair(): Mission[] {
  const a = makeMission(0);
  const b = makeMission(1, a.uniq);
  return [a, b];
}

const RECORD_MS = 4200;
const XP_PER = 15;

export function VoiceDonationScreen() {
  const navigation = useNavigation();
  const [consent, setConsent] = useState<boolean | null>(null);
  const [agree, setAgree] = useState(false);

  const [xp, setXp] = useState(0);
  const [streak, setStreak] = useState(0);
  const [count, setCount] = useState(0);
  const [pair, setPair] = useState<Mission[]>(makePair);
  const [recKey, setRecKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    hasDonationConsent().then(setConsent).catch(() => setConsent(false));
    (async () => {
      setXp((await getItem<number>('orbii:donation-xp')) ?? 0);
      setStreak((await getItem<number>('orbii:donation-streak')) ?? 0);
      setCount((await getItem<number>('orbii:donation-count')) ?? 0);
    })();
    return () => { if (timer.current) clearTimeout(timer.current); setSosSuppressed(false); };
  }, []);

  useEffect(() => {
    if (!recKey) { pulse.stopAnimation(); pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.18, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [recKey, pulse]);

  const level = useMemo(() => Math.floor(xp / 100) + 1, [xp]);
  const levelPct = xp % 100;

  const accept = async () => {
    await setDonationConsent(true);
    setConsent(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
  };

  const newPair = () => setPair(makePair());

  const run = async (m: Mission) => {
    if (recKey || uploading) return;
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) { appAlert('Microphone needed', 'Allow microphone access so ORBII can record your clip.'); return; }
    try {
      // Saying "help"/"bachao" into the mic must NOT fire the real Voice SOS
      // while we're just collecting a donation clip.
      setSosSuppressed(true);
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecKey(m.key);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      timer.current = setTimeout(async () => {
        let uri: string | null = null;
        try { await recorder.stop(); uri = recorder.uri ?? null; } catch { uri = null; }
        // Keep suppression a moment past stop, in case a fire is mid-flight.
        setTimeout(() => setSosSuppressed(false), 1500);
        setRecKey(null);
        if (!uri) { newPair(); return; }
        setUploading(true);
        const res = await uploadVoiceSample({ uri, phrase: m.phrase, lang: m.lang, context: m.ctxKey, durationMs: 4000 });
        setUploading(false);
        if (res === 'ok') {
          const nx = xp + XP_PER, ns = streak + 1, nc = count + 1;
          setXp(nx); setStreak(ns); setCount(nc);
          void setItem('orbii:donation-xp', nx); void setItem('orbii:donation-streak', ns); void setItem('orbii:donation-count', nc);
          setCelebrate(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        } else if (res === 'duplicate') {
          appAlert('Already got that one', 'We already have a clip just like it. Try a different mission.');
        } else if (res === 'no-consent') {
          setConsent(false);
        } else {
          appAlert("Couldn't save that clip", 'It did not go through. Check you are online, then try again in a moment.');
        }
        newPair();
      }, RECORD_MS);
    } catch {
      setSosSuppressed(false);
      setRecKey(null);
      appAlert('Recording failed', 'Please try again.');
    }
  };

  // ── Consent gate ──
  if (consent === null) return <View style={styles.root} />;
  if (!consent) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <Header title="Voice Quests" onBack={() => navigation.goBack()} />
          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.heroIcon}><Ionicons name="game-controller" size={30} color={colors.brandDeep} /></View>
            <Text style={styles.title}>Play a game, teach ORBII</Text>
            <Text style={styles.body}>
              By default your voice stays on your phone. You can choose to donate short
              clips through quick missions, and help ORBII hear more women, more
              accents, and noisier places.
            </Text>
            <View style={styles.factCard}>
              <Fact icon="cloud-upload-outline" text="Only the clips you record here are uploaded." />
              <Fact icon="eye-off-outline" text="Stored privately for training. Never shown to others, never sold." />
              <Fact icon="hand-left-outline" text="Optional and reversible. Stop any time." />
            </View>
            <Pressable onPress={() => setAgree((a) => !a)} style={styles.agreeRow}>
              <View style={[styles.check, agree && styles.checkOn]}>{agree ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}</View>
              <Text style={styles.agreeText}>I am happy to share my voice recordings to help train ORBII's model.</Text>
            </Pressable>
            <Pressable onPress={accept} disabled={!agree} style={[styles.cta, !agree && styles.ctaOff]}>
              <Text style={styles.ctaText}>Start playing</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // ── Game ──
  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <Header title="Voice Quests" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Stats */}
          <View style={styles.statsRow}>
            <Stat icon="star" tint={colors.brandDeep} value={`Lvl ${level}`} label={`${xp} XP`} />
            <Stat icon="flame" tint={colors.coralDeep} value={`${streak}`} label="streak" />
            <Stat icon="mic" tint={colors.sageDeep} value={`${count}`} label="donated" />
          </View>
          <View style={styles.xpTrack}><View style={[styles.xpFill, { width: `${levelPct}%` }]} /></View>

          {recKey ? (
            <View style={styles.recBox}>
              <Animated.View style={[styles.recOrb, { transform: [{ scale: pulse }] }]}>
                <Ionicons name="mic" size={40} color="#fff" />
              </Animated.View>
              <Text style={styles.recText}>Recording… say it now</Text>
            </View>
          ) : uploading ? (
            <View style={styles.recBox}>
              <View style={[styles.recOrb, { backgroundColor: colors.sage }]}><Ionicons name="cloud-upload" size={36} color="#fff" /></View>
              <Text style={styles.recText}>Sending your clip…</Text>
            </View>
          ) : (
            <>
              <Text style={styles.pickLabel}>Pick a mission</Text>
              <View style={{ gap: spacing.md }}>
                {pair.map((m) => (
                  <Pressable
                    key={m.key}
                    onPress={() => run(m)}
                    style={({ pressed }) => [
                      styles.mission,
                      { borderColor: m.accent, borderBottomWidth: pressed ? 2 : 6, marginBottom: pressed ? 4 : 0 },
                    ]}
                  >
                    <View style={[styles.missionIcon, { backgroundColor: m.accent }]}><Ionicons name={m.icon} size={26} color="#fff" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.missionText}>{m.instruction}</Text>
                      <View style={[styles.xpChip, { backgroundColor: m.accent }]}><Text style={styles.xpChipText}>+{XP_PER} XP</Text></View>
                    </View>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={newPair} style={styles.shuffle} hitSlop={8}>
                <Ionicons name="shuffle" size={15} color={colors.textSecondary} />
                <Text style={styles.shuffleText}>Neither fits, deal new ones</Text>
              </Pressable>
            </>
          )}

          {/* Badges */}
          <Text style={styles.badgeHead}>Your badges</Text>
          <View style={styles.badges}>
            {BADGES.map((b) => {
              const on = count >= b.n;
              return (
                <View key={b.name} style={[styles.badge, on && styles.badgeOn]}>
                  <Ionicons name={b.icon} size={20} color={on ? colors.brandDeep : colors.textMuted} />
                  <Text style={[styles.badgeName, on && styles.badgeNameOn]}>{b.name}</Text>
                  <Text style={styles.badgeReq}>{on ? 'Unlocked' : `${b.n} clips`}</Text>
                </View>
              );
            })}
          </View>
        </ScrollView>
        <Celebration visible={celebrate} originY={0.28} onDone={() => setCelebrate(false)} />
      </SafeAreaView>
    </View>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.back}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}
function Stat({ icon, tint, value, label }: { icon: IconName; tint: string; value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={18} color={tint} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Fact({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={17} color={colors.sageDeep} />
      <Text style={styles.factText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', ...shadows.icon },
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl },

  heroIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginTop: spacing.md, marginBottom: spacing.md },
  title: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary, textAlign: 'center', marginTop: spacing.sm },
  body: { ...typography.body, fontSize: 14, lineHeight: 21, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.xs },
  factCard: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, marginTop: spacing.lg, ...shadows.card },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  factText: { flex: 1, ...typography.bodyMedium, fontSize: 13, color: colors.textPrimary, lineHeight: 18 },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.brandMid, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  agreeText: { flex: 1, ...typography.body, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  cta: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', marginTop: spacing.lg, ...shadows.card },
  ctaOff: { opacity: 0.45 },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },

  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, paddingVertical: spacing.md, alignItems: 'center', gap: 2, ...shadows.card },
  statValue: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary },
  statLabel: { ...typography.caption, fontSize: 11, color: colors.textMuted },
  xpTrack: { height: 8, borderRadius: 99, backgroundColor: colors.creamDeep, overflow: 'hidden', marginTop: spacing.md },
  xpFill: { height: 8, borderRadius: 99, backgroundColor: colors.brand },

  pickLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.md },
  mission: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surface, borderRadius: 20, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, borderWidth: 2, borderBottomWidth: 6 },
  missionIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  missionText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary, lineHeight: 21 },
  xpChip: { alignSelf: 'flex-start', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3, marginTop: 6 },
  xpChipText: { fontFamily: fontFamilies.poppinsBold, fontSize: 11, color: '#fff', letterSpacing: 0.3 },
  shuffle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md, paddingVertical: spacing.sm },
  shuffleText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },

  recBox: { alignItems: 'center', paddingVertical: spacing.xxl },
  recOrb: { width: 110, height: 110, borderRadius: 55, backgroundColor: colors.coral, alignItems: 'center', justifyContent: 'center', ...shadows.card },
  recText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary, marginTop: spacing.lg },

  badgeHead: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary, marginTop: spacing.xl, marginBottom: spacing.md },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  badge: { width: '47%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md, alignItems: 'center', gap: 4, opacity: 0.55, ...shadows.icon },
  badgeOn: { opacity: 1, borderWidth: 1.5, borderColor: colors.brandSoft },
  badgeName: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.textSecondary },
  badgeNameOn: { color: colors.textPrimary },
  badgeReq: { ...typography.caption, fontSize: 10.5, color: colors.textMuted },
});
