import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
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

export function VoicePhrasesScreen() {
  const navigation = useNavigation();
  const [phrases, setPhrases] = useState<string[]>([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    loadPhrases().then(setPhrases);
  }, []);

  const onAdd = async () => {
    const text = input.trim();
    if (text.length < VOICE_PHRASE_LIMITS.min) return;
    const next = await addPhrase(text);
    setPhrases(next);
    setInput('');
  };

  const onRemove = async (p: string) => {
    setPhrases(await removePhrase(p));
  };

  const atLimit = phrases.length >= VOICE_PHRASE_LIMITS.max;

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
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, ...typography.caption, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
});
