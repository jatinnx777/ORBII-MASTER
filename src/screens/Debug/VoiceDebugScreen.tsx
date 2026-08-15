import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  getVoiceMetrics,
  resetVoiceMetrics,
  voiceMetricsSupported,
  type VoiceMetrics,
} from '@/services/voice-metrics';
import {
  startListening,
  stopListening,
  subscribeStatus,
  type VoiceDetectionStatus,
} from '@/services/voice-detection';

const SCENARIOS = ['On table', 'Pocket', 'Purse', 'Backpack', 'Distance', 'Noisy'] as const;
type Scenario = (typeof SCENARIOS)[number];

// Hidden diagnostics for tuning real-world Voice SOS detection. Shows the live
// RMS / VAD / gain / recognition state and counts triggers so you can measure
// detection rate + latency per scenario (pocket, purse, distance, noise).
export function VoiceDebugScreen() {
  const navigation = useNavigation();
  const [m, setM] = useState<VoiceMetrics | null>(null);
  const [status, setStatus] = useState<VoiceDetectionStatus>('idle');
  const [scenario, setScenario] = useState<Scenario>('On table');
  const peakRms = useRef(0);
  const [peak, setPeak] = useState(0);

  useEffect(() => subscribeStatus(setStatus), []);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const next = await getVoiceMetrics();
      if (!alive) return;
      setM(next);
      if (next && next.rms > peakRms.current) {
        peakRms.current = next.rms;
        setPeak(Math.round(next.rms));
      }
    };
    tick();
    const id = setInterval(tick, 200);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const listening = status === 'listening' || status === 'starting';
  const toggle = async () => {
    if (listening) stopListening();
    else await startListening();
  };

  const reset = async () => {
    await resetVoiceMetrics();
    peakRms.current = 0;
    setPeak(0);
  };

  // RMS bar scaled so normal speech (~1500–4000) fills most of it.
  const rms = m?.rms ?? 0;
  const rmsPct = Math.min(100, (rms / 4000) * 100);
  const thrPct = Math.min(100, ((m?.vadThreshold ?? 200) / 4000) * 100);

  if (!voiceMetricsSupported) {
    return (
      <View style={styles.root}>
        <SafeAreaView style={styles.safe} edges={['top']}>
          <Header onBack={() => navigation.goBack()} />
          <Text style={styles.unsupported}>
            Voice metrics aren't available in this build (native VoiceGuard module not found).
          </Text>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* status pills */}
          <View style={styles.pillRow}>
            <Pill label={listening ? 'Listening' : 'Stopped'} on={listening} />
            <Pill label={m?.running ? 'Engine up' : 'Engine down'} on={!!m?.running} />
            <Pill label={m?.grammarMode ? 'Grammar mode' : 'Free-form'} on={!!m?.grammarMode} />
          </View>

          {/* live RMS + VAD */}
          <View style={styles.card}>
            <Row label="Mic level (RMS)" value={Math.round(rms).toString()} />
            <View style={styles.barTrack}>
              <View
                style={[
                  styles.barFill,
                  { width: `${rmsPct}%`, backgroundColor: m?.vadActive ? colors.sage : colors.creamDeep },
                ]}
              />
              {/* VAD threshold marker */}
              <View style={[styles.thrMark, { left: `${thrPct}%` }]} />
            </View>
            <Row label="VAD (speech?)" value={m?.vadActive ? 'ACTIVE' : 'silence'} highlight={m?.vadActive} />
            <Row label="Auto-gain" value={`${(m?.gain ?? 1).toFixed(2)}×`} />
            <Row label="Peak RMS seen" value={peak.toString()} />
            <Row label="VAD threshold" value={Math.round(m?.vadThreshold ?? 0).toString()} />
          </View>

          {/* recognition */}
          <View style={styles.card}>
            <Text style={styles.cardHead}>Recognition</Text>
            <Row label="Heard" value={m?.lastText ? `"${m.lastText}"` : '-'} />
            <Row label="Confidence" value={m?.lastConfidence ? m.lastConfidence.toFixed(2) : '-'} />
            <Row label="Last trigger" value={m?.lastTriggerPhrase || '-'} highlight={!!m?.lastTriggerPhrase} />
            <Row label="Last latency" value={m?.lastLatencyMs ? `${m.lastLatencyMs} ms` : '-'} />
          </View>

          {/* session counters */}
          <View style={[styles.card, styles.counterCard]}>
            <View style={styles.counterCol}>
              <Text style={styles.counterNum}>{m?.triggerCount ?? 0}</Text>
              <Text style={styles.counterLabel}>triggers</Text>
            </View>
            <View style={styles.counterDivider} />
            <View style={styles.counterCol}>
              <Text style={styles.counterNum}>
                {m?.avgLatencyMs ? Math.round(m.avgLatencyMs) : 0}
              </Text>
              <Text style={styles.counterLabel}>avg ms</Text>
            </View>
          </View>

          {/* scenario tag (for your own notes while testing) */}
          <Text style={styles.sectionLabel}>SCENARIO</Text>
          <View style={styles.chips}>
            {SCENARIOS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setScenario(s)}
                style={[styles.chip, scenario === s && styles.chipOn]}
              >
                <Text style={[styles.chipText, scenario === s && styles.chipTextOn]}>{s}</Text>
              </Pressable>
            ))}
          </View>

          {/* controls */}
          <View style={styles.actions}>
            <Pressable onPress={toggle} style={[styles.btn, listening ? styles.btnStop : styles.btnStart]}>
              <Ionicons name={listening ? 'stop' : 'mic'} size={18} color={colors.textInverse} />
              <Text style={styles.btnText}>{listening ? 'Stop listening' : 'Start listening'}</Text>
            </Pressable>
            <Pressable onPress={reset} style={[styles.btn, styles.btnReset]}>
              <Ionicons name="refresh" size={18} color={colors.textPrimary} />
              <Text style={[styles.btnText, { color: colors.textPrimary }]}>Reset counts</Text>
            </Pressable>
          </View>

          <Text style={styles.note}>
            How to measure: pick a scenario, tap Reset, then say a trigger phrase
            10 times. Detection rate = triggers ÷ 10. For false triggers, Reset
            and stay silent / play noise for 2 minutes, any triggers are false.
            Compare avg ms before vs after. (Saying the phrase here fires a real
            SOS countdown, cancel it each time, or test from a screen where the
            countdown is expected.)
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={10} style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
      </Pressable>
      <Text style={styles.title}>Voice Debug</Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

function Pill({ label, on }: { label: string; on: boolean }) {
  return (
    <View style={[styles.pill, on ? styles.pillOn : styles.pillOff]}>
      <View style={[styles.pillDot, { backgroundColor: on ? colors.sage : colors.textMuted }]} />
      <Text style={[styles.pillText, on && { color: colors.sageDeep }]}>{label}</Text>
    </View>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, highlight && { color: colors.coralDeep }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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
  title: { ...typography.h3, color: colors.textPrimary },
  unsupported: { ...typography.body, color: colors.textSecondary, padding: spacing.lg },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  pillRow: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  pillOn: { backgroundColor: colors.sageSoft },
  pillOff: { backgroundColor: colors.surfaceAlt },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardHead: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textMuted,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  barTrack: {
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.cream,
    overflow: 'hidden',
    marginVertical: 4,
    justifyContent: 'center',
  },
  barFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 7 },
  thrMark: { position: 'absolute', width: 2, top: 0, bottom: 0, backgroundColor: colors.coral },
  metricRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metricLabel: { fontFamily: fontFamilies.interMedium, fontSize: 13.5, color: colors.textSecondary },
  metricValue: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
    maxWidth: '60%',
  },
  counterCard: { flexDirection: 'row', alignItems: 'center' },
  counterCol: { flex: 1, alignItems: 'center' },
  counterNum: { fontFamily: fontFamilies.poppinsBold, fontSize: 30, color: colors.peachDeep },
  counterLabel: { ...typography.caption, color: colors.textSecondary },
  counterDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.divider, marginVertical: spacing.sm },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.icon,
  },
  chipOn: { backgroundColor: colors.peachDeep },
  chipText: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textSecondary },
  chipTextOn: { color: colors.textInverse },
  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
  },
  btnStart: { backgroundColor: colors.sage },
  btnStop: { backgroundColor: colors.coral },
  btnReset: { backgroundColor: colors.surfaceAlt },
  btnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14, color: colors.textInverse },
  note: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});
