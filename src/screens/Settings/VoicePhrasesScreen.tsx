import React, { useEffect, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { IconBadge, Mascot } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import {
  PROTECTION_DURATIONS,
  backgroundVoiceAvailable,
  isBatteryExempt,
  loadBgVoiceState,
  saveBgVoiceState,
  startBackgroundVoice,
  stopBackgroundVoice,
} from '@/services/background-voice';
import { useIsPremium } from '@/services/entitlements';
import { promptUpgrade } from '@/services/paywall';
import {
  downloadHindiPack,
  HINDI_PACK,
  hindiPackSupported,
  isHindiReady,
  removeHindiPack,
} from '@/services/voice-language';

// Voice SOS settings. There is no custom phrase to set — in a real emergency
// nobody remembers an invented secret word, they just shout "help, help". The
// engine listens for the built-in panic words (always on, on-device). This
// screen only manages the optional Hindi language pack and always-on
// background protection.
export function VoicePhrasesScreen() {
  const navigation = useNavigation();
  const isPremium = useIsPremium();
  const [bgEnabled, setBgEnabled] = useState(false);
  const [bgHours, setBgHours] = useState(2);

  useEffect(() => {
    loadBgVoiceState().then((s) => {
      setBgEnabled(s.enabled);
      // Clamp any legacy value (12h/24h/indefinite) to the 8h cap.
      setBgHours(s.hours > 0 && s.hours <= 8 ? s.hours : 2);
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
      const ok = await ensureMicPerms();
      if (!ok) {
        appAlert('Microphone needed', 'Allow microphone access so ORBII can listen for a call for help.');
        return;
      }
      const started = await startBackgroundVoice([], bgHours);
      if (!started) {
        appAlert('Not available', 'Background protection runs only on the Android app build.');
        return;
      }
      setBgEnabled(true);
      saveBgVoiceState({ enabled: true, hours: bgHours });
      // Proactive reliability nudge: if the phone can still doze/kill ORBII,
      // Voice SOS may silently stop in the background. Offer the fix now rather
      // than waiting for a kill to be detected.
      const exempt = await isBatteryExempt();
      if (!exempt) {
        appAlert(
          'Keep ORBII listening',
          'Your phone may pause Voice SOS in the background to save battery. Two quick settings stop that.',
          [
            { text: 'Later', style: 'cancel' },
            { text: 'Show me how', onPress: () => navigation.navigate('VoiceReliability' as never) },
          ],
        );
      }
    } else {
      await stopBackgroundVoice();
      setBgEnabled(false);
      saveBgVoiceState({ enabled: false, hours: bgHours });
    }
  };

  const changeDuration = (hours: number) => {
    setBgHours(hours);
    saveBgVoiceState({ enabled: bgEnabled, hours });
    if (bgEnabled) startBackgroundVoice([], hours);
  };

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
          <Pressable
            onLongPress={() => navigation.navigate('VoiceDebug' as never)}
            delayLongPress={700}
            accessibilityRole="header"
          >
            <Text style={styles.title}>Voice SOS</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Mascot pose="headset" size={120} />
            <Text style={styles.heroTitle}>Just shout for help</Text>
            <Text style={styles.heroBody}>
              If you can't reach your phone, shout "help, help" and ORBII fires
              an SOS, hands-free. Nothing to set up, nothing to remember.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>What ORBII listens for</Text>
            <View style={styles.cueRow}>
              <IconBadge icon="volume-high" tint="coral" size={36} />
              <Text style={styles.cueText}>"Help, help"  ·  "Save me"</Text>
            </View>
            <View style={styles.cueRow}>
              <IconBadge icon="language" tint="lavender" size={36} />
              <Text style={styles.cueText}>"बचाओ"  ·  "मदद"  (with the Hindi pack)</Text>
            </View>
          </View>

          <LanguageCard />

          {backgroundVoiceAvailable ? (
            <View style={styles.card}>
              <View style={styles.bgHead}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.bgTitle}>Background protection</Text>
                  <Text style={styles.bgSub}>
                    Keep listening even when the app is closed. Runs on-device,
                    nothing is uploaded.
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

          {backgroundVoiceAvailable ? (
            <Pressable
              onPress={() => navigation.navigate('VoiceReliability' as never)}
              style={({ pressed }) => [styles.reliabilityRow, pressed && { opacity: 0.9 }]}
              accessibilityRole="button"
            >
              <IconBadge icon="battery-charging" tint="sage" size={36} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reliabilityTitle}>Keep it running on your phone</Text>
                <Text style={styles.bgSub}>
                  Stop your phone pausing Voice SOS in the background.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </Pressable>
          ) : null}

          <View style={styles.note}>
            <Ionicons name="shield-checkmark" size={16} color={colors.sageDeep} />
            <Text style={styles.noteText}>
              "Help" and "save me" always work in English, on-device. Add the
              Hindi pack above for "bachao" and "madad". Your voice never leaves
              this phone.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// Manage voice languages. English is bundled (always on); Hindi is an optional
// pack the user can download or remove here to control storage use.
function LanguageCard() {
  const supported = hindiPackSupported();
  const [ready, setReady] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    isHindiReady().then(setReady);
  }, []);

  if (!supported) return null;

  const onDownload = async () => {
    setDownloading(true);
    setProgress(0);
    const ok = await downloadHindiPack(setProgress);
    setDownloading(false);
    if (ok) setReady(true);
    else
      appAlert(
        'Download failed',
        'Could not download the Hindi pack. Check your connection and try again.',
      );
  };

  const onRemove = () => {
    appAlert(
      'Remove Hindi pack?',
      'Voice SOS keeps working in English. You can re-download Hindi anytime, free.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            await removeHindiPack();
            setReady(false);
          },
        },
      ],
    );
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>Languages</Text>

      <View style={styles.langRow}>
        <IconBadge icon="globe-outline" tint="sage" size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.langName}>English</Text>
          <Text style={styles.bgSub}>Always on · built in</Text>
        </View>
        <View style={styles.langOnPill}>
          <Text style={styles.langOnText}>On</Text>
        </View>
      </View>

      <View style={styles.langDivider} />

      <View style={styles.langRow}>
        <IconBadge icon="language-outline" tint="lavender" size={36} />
        <View style={{ flex: 1 }}>
          <Text style={styles.langName}>Hindi</Text>
          <Text style={styles.bgSub}>
            {ready
              ? 'Installed · बचाओ, मदद'
              : `Optional · ${HINDI_PACK.downloadMb} MB download`}
          </Text>
        </View>
        {ready ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        ) : downloading ? (
          <Text style={styles.bgSub}>{progress}%</Text>
        ) : (
          <Pressable
            onPress={onDownload}
            style={({ pressed }) => [styles.getBtn, pressed && { opacity: 0.9 }]}
          >
            <Ionicons name="cloud-download" size={15} color={colors.textInverse} />
            <Text style={styles.getText}>Get</Text>
          </Pressable>
        )}
      </View>

      {downloading ? (
        <View style={styles.langBarTrack}>
          <View style={[styles.langBarFill, { width: `${Math.max(progress, 4)}%` }]} />
        </View>
      ) : null}
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
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm },
  cueText: { flex: 1, ...typography.bodyMedium, color: colors.textPrimary },
  langRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  langDivider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.md },
  langName: { ...typography.bodyMedium, fontFamily: 'Poppins_600SemiBold', color: colors.textPrimary },
  langOnPill: {
    backgroundColor: colors.sage,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radius.pill,
  },
  langOnText: { fontFamily: 'Poppins_600SemiBold', fontSize: 12, color: colors.textInverse },
  removeText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: colors.coralDeep },
  getBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.peachDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  getText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: colors.textInverse },
  langBarTrack: { height: 7, borderRadius: 4, backgroundColor: colors.cream, overflow: 'hidden', marginTop: spacing.md },
  langBarFill: { height: '100%', borderRadius: 4, backgroundColor: colors.peachDeep },
  reliabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.lg,
    ...shadows.card,
  },
  reliabilityTitle: {
    ...typography.bodyMedium,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
  },
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
