import React, { useEffect, useState } from 'react';
import {
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Mascot } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
import {
  isBatteryExempt,
  openAppSettings,
  openAutostartSettings,
  requestBatteryExemption,
} from '@/services/background-voice';

// "Keep ORBII listening" — the OEM-survival screen. Over 70% of phones sold in
// India (Xiaomi, Samsung, Oppo, Vivo, Realme) aggressively kill background
// services. Battery-optimization exemption alone isn't enough on those skins;
// they each hide an Autostart / Auto-launch toggle that actually decides
// whether our foreground service survives. This screen detects the phone and
// walks the user through the two or three switches that matter, with one-tap
// buttons into the exact settings pages.

type Guide = {
  /** Human name shown in the header ("Xiaomi / Redmi / Poco"). */
  name: string;
  /** dontkillmyapp.com vendor slug for the "exact steps" deep link. */
  dkma: string;
  /** Whether this OEM has an Autostart manager worth surfacing a button for. */
  hasAutostart: boolean;
  steps: string[];
};

const GUIDES: Record<string, Guide> = {
  xiaomi: {
    name: 'Xiaomi / Redmi / Poco',
    dkma: 'xiaomi',
    hasAutostart: true,
    steps: [
      'Turn on Autostart for ORBII (button below).',
      'Set Battery saver for ORBII to "No restrictions".',
      'In Recent apps, swipe down on ORBII and tap the lock icon so it isn’t cleared.',
    ],
  },
  oppo: {
    name: 'Oppo / Realme',
    dkma: 'oppo',
    hasAutostart: true,
    steps: [
      'Turn on "Allow Auto Launch" for ORBII (button below).',
      'In Battery, allow ORBII to run in the background / stop optimising it.',
      'In Recent apps, lock ORBII so it isn’t cleared.',
    ],
  },
  vivo: {
    name: 'Vivo / iQOO',
    dkma: 'vivo',
    hasAutostart: true,
    steps: [
      'Turn on Autostart for ORBII (button below).',
      'In Battery → Background power consumption, allow ORBII to run.',
      'In Recent apps, lock ORBII so it isn’t cleared.',
    ],
  },
  samsung: {
    name: 'Samsung',
    dkma: 'samsung',
    hasAutostart: false,
    steps: [
      'In App info → Battery, set ORBII to "Unrestricted".',
      'In Settings → Battery → Background usage limits, make sure ORBII is NOT in "Sleeping apps", and add it to "Never sleeping apps".',
    ],
  },
  oneplus: {
    name: 'OnePlus',
    dkma: 'oneplus',
    hasAutostart: true,
    steps: [
      'In App info → Battery, choose "Unrestricted" / allow background activity.',
      'Turn off "Deep optimisation" and allow auto-launch for ORBII (button below).',
      'In Recent apps, lock ORBII so it isn’t cleared.',
    ],
  },
  huawei: {
    name: 'Huawei / Honor',
    dkma: 'huawei',
    hasAutostart: true,
    steps: [
      'In App launch, switch ORBII to Manage manually and turn ON Auto-launch, Secondary launch and Run in background (button below).',
      'In Battery, allow ORBII to run in the background.',
    ],
  },
  other: {
    name: 'your phone',
    dkma: '',
    hasAutostart: false,
    steps: [
      'Allow ORBII to run in the background / turn off battery optimisation (button below).',
      'If your phone has an Autostart or Auto-launch list, add ORBII to it.',
      'In Recent apps, lock ORBII so it isn’t cleared.',
    ],
  },
};

function detectVendor(): { key: string; brand: string; model: string } {
  const c = (Platform.constants as unknown as {
    Manufacturer?: string;
    Brand?: string;
    Model?: string;
  }) ?? {};
  const man = String(c.Manufacturer ?? '').toLowerCase();
  const brand = String(c.Brand ?? c.Manufacturer ?? '').trim() || 'Android';
  const model = String(c.Model ?? '').trim();
  const hay = `${man} ${brand.toLowerCase()}`;
  const has = (...names: string[]) => names.some((n) => hay.includes(n));
  let key = 'other';
  if (has('xiaomi', 'redmi', 'poco')) key = 'xiaomi';
  else if (has('oppo', 'realme')) key = 'oppo';
  else if (has('vivo', 'iqoo')) key = 'vivo';
  else if (has('samsung')) key = 'samsung';
  else if (has('oneplus')) key = 'oneplus';
  else if (has('huawei', 'honor')) key = 'huawei';
  return { key, brand, model };
}

export function VoiceReliabilityScreen() {
  const navigation = useNavigation();
  const [{ key, brand, model }] = useState(detectVendor);
  const guide = GUIDES[key] ?? GUIDES.other;
  const [batteryOk, setBatteryOk] = useState<boolean | null>(null);

  const refreshBattery = () => {
    isBatteryExempt().then(setBatteryOk);
  };
  useEffect(refreshBattery, []);

  const onAllowBackground = async () => {
    await requestBatteryExemption();
    // The system dialog is async; re-check shortly after they return.
    setTimeout(refreshBattery, 1500);
  };

  const openExactSteps = () => {
    const url = guide.dkma
      ? `https://dontkillmyapp.com/${guide.dkma}`
      : 'https://dontkillmyapp.com';
    Linking.openURL(url).catch(() => undefined);
  };

  const androidOnly = Platform.OS === 'android';

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
          <Text style={styles.title}>Keep it running</Text>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hero}>
            <Mascot pose="shield" size={112} />
            <Text style={styles.heroTitle}>Stop your phone pausing ORBII</Text>
            <Text style={styles.heroBody}>
              To save battery, many phones quietly close background apps, which
              can switch off Voice SOS without telling you. These quick settings
              keep ORBII listening.
            </Text>
          </View>

          <View style={styles.phonePill}>
            <Ionicons name="phone-portrait-outline" size={16} color={colors.brandDeep} />
            <Text style={styles.phoneText}>
              {brand}
              {model ? ` ${model}` : ''} · steps for {guide.name}
            </Text>
          </View>

          {androidOnly ? (
            <>
              <View style={styles.card}>
                <Text style={styles.label}>Do these {guide.steps.length} things</Text>
                {guide.steps.map((s, i) => (
                  <View key={i} style={styles.step}>
                    <View style={styles.stepNum}>
                      <Text style={styles.stepNumText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.stepText}>{s}</Text>
                  </View>
                ))}
              </View>

              <Pressable
                onPress={onAllowBackground}
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.9 }]}
              >
                <Ionicons
                  name={batteryOk ? 'checkmark-circle' : 'battery-charging'}
                  size={18}
                  color={colors.textInverse}
                />
                <Text style={styles.primaryText}>
                  {batteryOk ? 'Background running allowed' : 'Allow background running'}
                </Text>
              </Pressable>

              {guide.hasAutostart ? (
                <Pressable
                  onPress={openAutostartSettings}
                  style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
                >
                  <Ionicons name="rocket-outline" size={18} color={colors.brandDeep} />
                  <Text style={styles.secondaryText}>Open Autostart settings</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={openAppSettings}
                style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
              >
                <Ionicons name="settings-outline" size={18} color={colors.brandDeep} />
                <Text style={styles.secondaryText}>Open ORBII app settings</Text>
              </Pressable>

              <Pressable onPress={openExactSteps} style={styles.linkRow} hitSlop={8}>
                <Ionicons name="open-outline" size={15} color={colors.textSecondary} />
                <Text style={styles.linkText}>See exact steps with screenshots for my phone</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.heroBody}>
                Background Voice SOS runs on the Android app. These reliability
                steps only apply there.
              </Text>
            </View>
          )}

          <View style={styles.note}>
            <Ionicons name="shield-checkmark" size={16} color={colors.sageDeep} />
            <Text style={styles.noteText}>
              If your phone ever pauses ORBII in the background, it turns Voice
              SOS back on the next time you open the app and lets you know.
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
  heroTitle: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  heroBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 340,
  },
  phonePill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    backgroundColor: colors.creamDeep,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  phoneText: { ...typography.label, color: colors.brandDeep },
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
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNumText: { fontFamily: 'Poppins_600SemiBold', fontSize: 13, color: colors.brandDeep },
  stepText: { flex: 1, ...typography.bodyMedium, color: colors.textPrimary, lineHeight: 21 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.brandDeep,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    ...shadows.card,
  },
  primaryText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: colors.textInverse },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  secondaryText: { fontFamily: 'Poppins_600SemiBold', fontSize: 15, color: colors.brandDeep },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing.sm,
  },
  linkText: { ...typography.caption, fontSize: 13, color: colors.textSecondary, textDecorationLine: 'underline' },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.sageSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, ...typography.caption, fontSize: 12.5, color: colors.textSecondary, lineHeight: 17 },
});
