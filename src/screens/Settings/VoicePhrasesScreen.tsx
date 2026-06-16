import React, { useEffect, useState } from 'react';
import {
  Alert,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { IconBadge, Mascot } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import {
  PHRASE_EXAMPLES,
  VOICE_PHRASE_LIMITS,
  addPhrase,
  loadPhrases,
  removePhrase,
} from '@/services/voice-phrases';
import {
  PROTECTION_DURATIONS,
  backgroundVoiceAvailable,
  loadBgVoiceState,
  saveBgVoiceState,
  startBackgroundVoice,
  stopBackgroundVoice,
} from '@/services/background-voice';
import { useIsPremium, FREE_VOICE_PHRASE_LIMIT } from '@/services/entitlements';
import { promptUpgrade } from '@/services/paywall';

export function VoicePhrasesScreen() {
  const navigation = useNavigation();
  const isPremium = useIsPremium();
  const [phrases, setPhrases] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgHours, setBgHours] = useState(12);

  useEffect(() => {
    loadPhrases().then(setPhrases);
    loadBgVoiceState().then((s) => {
      setBgEnabled(s.enabled);
      setBgHours(s.hours);
    });
  }, []);

  const ensureMicPerms = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    const mic = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (mic !== PermissionsAndroid.RESULTS.GRANTED) return false;
    if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
      await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
    }
    return true;
  };

  const toggleBg = async (next: boolean) => {
    if (next) {
      // Background voice monitoring is an ORBII Plus feature.
      if (!isPremium) {
        promptUpgrade({
          feature: 'Background voice monitoring',
          onUpgrade: () => navigation.navigate('PremiumUpgrade' as never),
        });
        return;
      }
      if (phrases.length === 0) {
        Alert.alert('Add a phrase first', 'Set at least one secret phrase before turning on background protection.');
        return;
      }
      const ok = await ensureMicPerms();
      if (!ok) {
        Alert.alert('Microphone needed', 'Allow microphone access so ORBII can listen for your phrase.');
        return;
      }
      const started = await startBackgroundVoice(phrases, bgHours);
      if (!started) {
        Alert.alert('Not available', 'Background protection runs only on the Android app build.');
        return;
      }
      setBgEnabled(true);
      saveBgVoiceState({ enabled: true, hours: bgHours });
    } else {
      await stopBackgroundVoice();
      setBgEnabled(false);
      saveBgVoiceState({ enabled: false, hours: bgHours });
    }
  };

  const changeDuration = (hours: number) => {
    setBgHours(hours);
    saveBgVoiceState({ enabled: bgEnabled, hours });
    if (bgEnabled) startBackgroundVoice(phrases, hours);
  };

  const onAdd = async () => {
    const text = input.trim();
    if (text.length < VOICE_PHRASE_LIMITS.min) return;
    // Free tier: one trigger phrase. ORBII Plus: unlimited (up to the
    // technical max).
    if (!isPremium && phrases.length >= FREE_VOICE_PHRASE_LIMIT) {
      promptUpgrade({
        feature: 'Unlimited voice trigger phrases',
        body:
          'Free includes one trigger phrase. Upgrade to ORBII Plus (₹99/month) ' +
          'for unlimited custom phrases and multiple emergency keywords.',
        onUpgrade: () => navigation.navigate('PremiumUpgrade' as never),
      });
      return;
    }
    const next = await addPhrase(text);
    setPhrases(next);
    setInput('');
  };

  const onRemove = async (p: string) => {
    setPhrases(await removePhrase(p));
  };

  const effectiveMax = isPremium
    ? VOICE_PHRASE_LIMITS.max
    : FREE_VOICE_PHRASE_LIMIT;
  const atLimit = phrases.length >= effectiveMax;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Voice SOS</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Mascot pose="headset" size={120} />
            <Text style={styles.heroTitle}>Choose your secret phrase</Text>
            <Text style={styles.heroBody}>
              ORBII listens for your phrase and fires an SOS, hands-free. Pick
              something you'd only say in an emergency.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>Your phrase</Text>
            <View style={styles.inputRow}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Type a phrase"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                editable={!atLimit}
                onSubmitEditing={onAdd}
                returnKeyType="done"
              />
              <Pressable
                onPress={onAdd}
                disabled={atLimit || input.trim().length < VOICE_PHRASE_LIMITS.min}
                style={({ pressed }) => [
                  styles.addBtn,
                  (atLimit || input.trim().length < VOICE_PHRASE_LIMITS.min) && styles.addBtnOff,
                  pressed && { opacity: 0.9 },
                ]}
              >
                <Ionicons name="add" size={22} color={colors.textPrimary} />
              </Pressable>
            </View>

            <Text style={styles.examplesLabel}>Examples</Text>
            <View style={styles.examples}>
              {PHRASE_EXAMPLES.map((ex) => (
                <Pressable
                  key={ex}
                  onPress={() => setInput(ex)}
                  style={({ pressed }) => [styles.exampleChip, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.exampleText}>{ex}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          {phrases.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.label}>Saved phrases</Text>
              {phrases.map((p) => (
                <View key={p} style={styles.phraseRow}>
                  <IconBadge icon="mic" tint="lavender" size={36} />
                  <Text style={styles.phraseText}>{p}</Text>
                  <Pressable onPress={() => onRemove(p)} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {backgroundVoiceAvailable ? (
            <View style={styles.card}>
              <View style={styles.bgHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bgTitle}>Background protection</Text>
                  <Text style={styles.bgSub}>
                    Keep listening for your phrase even when the app is closed.
                    Runs on-device, nothing is uploaded.
                  </Text>
                </View>
                <Switch
                  value={bgEnabled}
                  onValueChange={toggleBg}
                  trackColor={{ true: colors.sageSoft, false: colors.border }}
                  thumbColor={bgEnabled ? colors.sage : colors.surface}
                />
              </View>
              {bgEnabled ? (
                <View style={styles.durations}>
                  {PROTECTION_DURATIONS.map((d) => (
                    <Pressable
                      key={d.label}
                      onPress={() => changeDuration(d.hours)}
                      style={[styles.durChip, bgHours === d.hours && styles.durChipOn]}
                    >
                      <Text style={[styles.durText, bgHours === d.hours && styles.durTextOn]}>
                        {d.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={styles.note}>
            <Ionicons name="shield-checkmark" size={16} color={colors.sageDeep} />
            <Text style={styles.noteText}>
              The words "help", "bachao", and "madad" always work, even without
              a custom phrase. Your phrases never leave this device.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: { ...typography.h2, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  hero: { alignItems: 'center', gap: spacing.xs },
  heroTitle: { ...typography.h1, color: colors.textPrimary, marginTop: spacing.sm, textAlign: 'center' },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 320,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  inputRow: { flexDirection: 'row', gap: spacing.sm },
  input: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    color: colors.textPrimary,
  },
  addBtn: {
    width: 50,
    borderRadius: radius.md,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnOff: { backgroundColor: colors.creamDeep },
  examplesLabel: { ...typography.label, color: colors.textMuted, marginTop: spacing.md, marginBottom: spacing.sm },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  exampleChip: {
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
  },
  exampleText: { ...typography.label, color: colors.textSecondary },
  phraseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  phraseText: { flex: 1, ...typography.bodyMedium, color: colors.textPrimary },
  bgHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  bgTitle: { ...typography.bodyMedium, fontFamily: 'Poppins_600SemiBold', color: colors.textPrimary },
  bgSub: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17, marginTop: 2 },
  durations: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  durChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
  },
  durChipOn: { backgroundColor: colors.sage },
  durText: { ...typography.label, color: colors.textSecondary },
  durTextOn: { color: colors.textInverse },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, ...typography.caption, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
});
