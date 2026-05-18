import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import { getItem, setItem, storageKeys } from '@/services/storage';
import {
  BUILTIN_KEYWORDS,
  isVoiceNativeAvailable,
  type BuiltinKeyword,
} from '@/services/wake-word';

export function VoiceSetupScreen() {
  const navigation = useNavigation();
  const [accessKey, setAccessKey] = useState('');
  const [keyword, setKeyword] = useState<BuiltinKeyword>('JARVIS');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const native = isVoiceNativeAvailable();

  useEffect(() => {
    let alive = true;
    (async () => {
      const [savedKey, savedKeyword] = await Promise.all([
        getItem<string>(storageKeys.voiceAccessKey),
        getItem<BuiltinKeyword>(storageKeys.voiceKeyword),
      ]);
      if (!alive) return;
      if (savedKey) setAccessKey(savedKey);
      if (savedKeyword && BUILTIN_KEYWORDS.includes(savedKeyword)) {
        setKeyword(savedKeyword);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    const trimmed = accessKey.trim();
    if (trimmed.length < 30) {
      Alert.alert(
        'Looks too short',
        'Picovoice access keys are usually 50+ characters. Double-check what you copied.',
      );
      return;
    }
    setSaving(true);
    try {
      await Promise.all([
        setItem(storageKeys.voiceAccessKey, trimmed),
        setItem(storageKeys.voiceKeyword, keyword),
      ]);
      Alert.alert(
        'Saved',
        'Background Voice SOS is ready. Toggle it on from Settings whenever you want it active.',
      );
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <ScreenContainer><View /></ScreenContainer>;
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Background Voice SOS</Text>
          <View style={{ width: 38 }} />
        </View>

        <LinearGradient
          colors={[colors.brandSoft, '#FFFFFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.heroIcon}>
            <Ionicons name="mic" size={26} color={colors.brandDeep} />
          </View>
          <Text style={styles.heroTitle}>
            Always-on, on-device wake word
          </Text>
          <Text style={styles.heroBody}>
            ORBII listens for your wake word using Picovoice Porcupine —
            a tiny on-device model. Audio is processed locally; nothing
            ever leaves your phone. To enable it, paste a free access
            key from Picovoice Console.
          </Text>
        </LinearGradient>

        {!native ? (
          <View style={styles.unavailableCard}>
            <Ionicons
              name="alert-circle-outline"
              size={20}
              color={colors.warning}
            />
            <Text style={styles.unavailableText}>
              The native voice service isn't available in this build. Use the
              latest production APK to enable it.
            </Text>
          </View>
        ) : null}

        <Section title="Step 1 — Get a free access key" />
        <View style={styles.stepCard}>
          <Text style={styles.stepBody}>
            Open the Picovoice Console, sign in with Google, and copy the
            "AccessKey" string from your dashboard. The free tier covers
            personal use up to 3 devices — perfect for testing.
          </Text>
          <Pressable
            onPress={() =>
              Linking.openURL('https://console.picovoice.ai').catch(
                () => undefined,
              )
            }
            style={({ pressed }) => [
              styles.linkBtn,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="open-outline" size={14} color={colors.brandDeep} />
            <Text style={styles.linkBtnText}>Open Picovoice Console</Text>
          </Pressable>
        </View>

        <Section title="Step 2 — Paste the access key" />
        <TextInput
          value={accessKey}
          onChangeText={setAccessKey}
          placeholder="Paste your Picovoice AccessKey here"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          multiline
          style={styles.keyInput}
        />

        <Section title="Step 3 — Pick your wake word" />
        <Text style={styles.sectionHelp}>
          Built-in keywords work without paying anything. A custom
          "ORBII" wake word requires a Picovoice paid plan; we'll offer
          that as an upgrade later.
        </Text>
        <View style={styles.keywordGrid}>
          {BUILTIN_KEYWORDS.map((k) => {
            const selected = k === keyword;
            return (
              <Pressable
                key={k}
                onPress={() => setKeyword(k)}
                style={({ pressed }) => [
                  styles.keywordPill,
                  selected && styles.keywordPillSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.keywordPillText,
                    selected && styles.keywordPillTextSelected,
                  ]}
                >
                  {k}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={handleSave}
          disabled={saving || accessKey.trim().length === 0}
          style={({ pressed }) => [
            styles.saveBtn,
            (pressed || saving || !accessKey.trim()) && styles.pressed,
          ]}
        >
          <Ionicons name="checkmark" size={16} color={colors.textInverse} />
          <Text style={styles.saveBtnText}>
            {saving ? 'Saving…' : 'Save and finish setup'}
          </Text>
        </Pressable>

        <Text style={styles.privacy}>
          ORBII never streams audio. The wake-word model runs entirely
          on-device. The mic indicator (the green dot at the top of the
          screen) shows you exactly when ORBII is listening.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title }: { title: string }) {
  return <Text style={styles.section}>{title}</Text>;
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  heroCard: {
    borderRadius: 22,
    padding: spacing.lg,
    gap: 10,
  },
  heroIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  heroBody: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
  },
  unavailableCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#FFF6E5',
    borderRadius: 14,
    padding: 14,
    marginTop: spacing.md,
  },
  unavailableText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: '#7A4D00',
    lineHeight: 18,
  },
  section: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: spacing.lg,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  sectionHelp: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12.5,
    color: colors.textSecondary,
    paddingHorizontal: 4,
    marginBottom: 10,
    lineHeight: 18,
  },
  stepCard: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    gap: 10,
  },
  stepBody: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.brandSoft,
    alignSelf: 'flex-start',
  },
  linkBtnText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.brandDeep,
  },
  keyInput: {
    minHeight: 80,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textPrimary,
    textAlignVertical: 'top',
  },
  keywordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  keywordPill: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  keywordPillSelected: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  keywordPillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
    letterSpacing: 0.4,
  },
  keywordPillTextSelected: {
    color: colors.textInverse,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: touchTarget.comfortable,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    marginTop: spacing.lg,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  saveBtnText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  privacy: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
