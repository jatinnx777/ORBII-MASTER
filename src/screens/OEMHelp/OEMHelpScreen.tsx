import React, { useMemo, useState } from 'react';
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
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { ScreenContainer } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';

// OEM-specific Android setup helper. Detects manufacturer at runtime
// and surfaces the three steps each device family requires for ORBII to
// stay alive in the background:
//
//   • Disable battery optimization (universal)
//   • Allow autostart (Xiaomi / Vivo / Oppo / Realme / OnePlus)
//   • Allow "no restrictions" / "high background usage" (same group)
//
// Each step deep-links into the right Android settings screen. Where
// the deep-link target doesn't exist, we fall back to the generic
// app-info screen and show plain instructions.
//
// Why this matters: on MIUI / ColorOS / FuntouchOS, ORBII's foreground
// service (lock-screen SOS shortcut, listening badge, hardware-SOS
// detector) is killed within hours unless the user has manually
// granted these. We can't grant them programmatically, the OS
// requires the user to tap through. So we make it as smooth as
// possible.

type Manufacturer =
  | 'xiaomi'
  | 'redmi'
  | 'poco'
  | 'samsung'
  | 'oppo'
  | 'oneplus'
  | 'realme'
  | 'vivo'
  | 'iqoo'
  | 'motorola'
  | 'pixel'
  | 'nothing'
  | 'other';

function detectManufacturer(): Manufacturer {
  if (Platform.OS !== 'android') return 'other';
  const raw =
    (Platform as unknown as { constants?: { Manufacturer?: string; Brand?: string } })
      .constants ?? {};
  const m = (raw.Manufacturer ?? raw.Brand ?? '').toLowerCase();
  if (m.includes('xiaomi')) return 'xiaomi';
  if (m.includes('redmi')) return 'redmi';
  if (m.includes('poco')) return 'poco';
  if (m.includes('samsung')) return 'samsung';
  if (m.includes('oppo')) return 'oppo';
  if (m.includes('oneplus')) return 'oneplus';
  if (m.includes('realme')) return 'realme';
  if (m.includes('vivo')) return 'vivo';
  if (m.includes('iqoo')) return 'iqoo';
  if (m.includes('motorola')) return 'motorola';
  if (m.includes('google')) return 'pixel';
  if (m.includes('nothing')) return 'nothing';
  return 'other';
}

type Step = {
  id: string;
  title: string;
  detail: string;
  // Android settings action / package the deep-link targets. If null,
  // we fall back to opening the app's main Settings entry.
  intent?: 'battery' | 'autostart' | 'app-info';
};

const COMMON_BATTERY_STEP: Step = {
  id: 'battery',
  title: 'Disable battery optimization',
  detail:
    'Tell Android not to put ORBII to sleep. Without this, voice SOS, hardware-button SOS, and the lock-screen shortcut die within hours.',
  intent: 'battery',
};

const STEPS_BY_MANUFACTURER: Record<Manufacturer, Step[]> = {
  xiaomi: [
    COMMON_BATTERY_STEP,
    {
      id: 'autostart',
      title: 'Allow autostart (MIUI Security app)',
      detail:
        'Open Security → Permissions → Autostart → enable for ORBII. This is the single most important step on MIUI.',
      intent: 'autostart',
    },
    {
      id: 'no-restrictions',
      title: 'Background app battery: No restrictions',
      detail:
        'Settings → Apps → Manage apps → ORBII → Battery saver → No restrictions.',
      intent: 'app-info',
    },
    {
      id: 'lock-popup',
      title: 'Allow display pop-up while running in background',
      detail:
        'In ORBII\'s app info → Other permissions → enable "Display pop-up windows while running in background". Required for the SOS countdown to surface from a locked phone.',
      intent: 'app-info',
    },
  ],
  redmi: [],
  poco: [],
  samsung: [
    COMMON_BATTERY_STEP,
    {
      id: 'never-sleep',
      title: 'Never put ORBII to sleep',
      detail:
        'Settings → Battery → Background usage limits → Never sleeping apps → add ORBII.',
      intent: 'battery',
    },
    {
      id: 'unrestricted',
      title: 'Unrestricted battery usage',
      detail:
        'Settings → Apps → ORBII → Battery → Unrestricted.',
      intent: 'app-info',
    },
  ],
  oppo: [
    COMMON_BATTERY_STEP,
    {
      id: 'autostart',
      title: 'Allow autostart',
      detail:
        'Settings → Apps → App management → ORBII → Allow auto-launch.',
      intent: 'autostart',
    },
    {
      id: 'high-bg',
      title: 'High background power consumption',
      detail:
        'Settings → Battery → ORBII → enable High background power consumption.',
      intent: 'app-info',
    },
  ],
  oneplus: [],
  realme: [],
  vivo: [
    COMMON_BATTERY_STEP,
    {
      id: 'autostart',
      title: 'Allow autostart (iManager)',
      detail:
        'Open the iManager app → App manager → Autostart manager → enable for ORBII.',
      intent: 'autostart',
    },
    {
      id: 'high-bg',
      title: 'High background power consumption',
      detail:
        'Settings → Battery → Background power consumption management → enable for ORBII.',
      intent: 'app-info',
    },
  ],
  iqoo: [],
  motorola: [
    COMMON_BATTERY_STEP,
  ],
  pixel: [
    COMMON_BATTERY_STEP,
  ],
  nothing: [
    COMMON_BATTERY_STEP,
  ],
  other: [
    COMMON_BATTERY_STEP,
    {
      id: 'app-info',
      title: 'Open app info',
      detail:
        "We don't have specific steps for your phone yet. Open the app's Android settings and look for autostart, battery saver, and background-restriction options.",
      intent: 'app-info',
    },
  ],
};

// Brands that share the same OS family inherit the steps.
STEPS_BY_MANUFACTURER.redmi = STEPS_BY_MANUFACTURER.xiaomi;
STEPS_BY_MANUFACTURER.poco = STEPS_BY_MANUFACTURER.xiaomi;
STEPS_BY_MANUFACTURER.oneplus = STEPS_BY_MANUFACTURER.oppo;
STEPS_BY_MANUFACTURER.realme = STEPS_BY_MANUFACTURER.oppo;
STEPS_BY_MANUFACTURER.iqoo = STEPS_BY_MANUFACTURER.vivo;

const DISPLAY_NAME: Record<Manufacturer, string> = {
  xiaomi: 'Xiaomi',
  redmi: 'Redmi',
  poco: 'POCO',
  samsung: 'Samsung',
  oppo: 'OPPO',
  oneplus: 'OnePlus',
  realme: 'Realme',
  vivo: 'vivo',
  iqoo: 'iQOO',
  motorola: 'Motorola',
  pixel: 'Pixel',
  nothing: 'Nothing',
  other: 'your phone',
};

async function openIntent(intent: Step['intent']): Promise<void> {
  if (!intent) return;
  if (intent === 'battery') {
    // Generic battery optimization screen.
    await Linking.openSettings().catch(() => undefined);
    return;
  }
  if (intent === 'autostart') {
    // No universal deep-link for autostart. Best we can do is the
    // generic app settings, the user takes one tap from there.
    await Linking.openSettings().catch(() => undefined);
    return;
  }
  await Linking.openSettings().catch(() => undefined);
}

export function OEMHelpScreen() {
  const navigation = useNavigation();
  const manufacturer = useMemo(detectManufacturer, []);
  const [override, setOverride] = useState<Manufacturer | null>(null);
  const active = override ?? manufacturer;
  const steps = STEPS_BY_MANUFACTURER[active] ?? STEPS_BY_MANUFACTURER.other;
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  return (
    <ScreenContainer padded={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Background reliability</Text>
          <View style={{ width: 38 }} />
        </View>

        <LinearGradient
          colors={[colors.brandSoft, '#FFFFFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <Text style={styles.heroEyebrow}>YOUR PHONE</Text>
          <Text style={styles.heroTitle}>
            Help ORBII stay alive on {DISPLAY_NAME[active]}
          </Text>
          <Text style={styles.heroBody}>
            Android puts apps to sleep aggressively. Three quick settings
            below let ORBII keep listening for your SOS, even when you're
            not in the app.
          </Text>
        </LinearGradient>

        <Text style={styles.section}>Steps</Text>

        {steps.map((step, idx) => (
          <Pressable
            key={step.id}
            onPress={() => {
              setCompleted((prev) => {
                const next = new Set(prev);
                next.add(step.id);
                return next;
              });
              openIntent(step.intent);
            }}
            style={({ pressed }) => [
              styles.stepCard,
              completed.has(step.id) && styles.stepCardDone,
              pressed && styles.pressed,
            ]}
          >
            <View
              style={[
                styles.stepNum,
                completed.has(step.id) && styles.stepNumDone,
              ]}
            >
              {completed.has(step.id) ? (
                <Ionicons name="checkmark" size={14} color={colors.textInverse} />
              ) : (
                <Text style={styles.stepNumText}>{idx + 1}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{step.title}</Text>
              <Text style={styles.stepDetail}>{step.detail}</Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={16}
              color={colors.textSecondary}
            />
          </Pressable>
        ))}

        <Text style={styles.section}>Different phone?</Text>
        <View style={styles.brandGrid}>
          {(
            [
              'xiaomi',
              'samsung',
              'oppo',
              'vivo',
              'realme',
              'oneplus',
              'motorola',
              'pixel',
              'other',
            ] as Manufacturer[]
          ).map((m) => {
            const selected = active === m;
            return (
              <Pressable
                key={m}
                onPress={() => setOverride(m)}
                style={({ pressed }) => [
                  styles.brandPill,
                  selected && styles.brandPillSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[
                    styles.brandPillText,
                    selected && styles.brandPillTextSelected,
                  ]}
                >
                  {DISPLAY_NAME[m]}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.footnote}>
          The Android API doesn't let apps grant these permissions
          themselves, only you can. We only ever open Settings; we never
          touch other apps.
        </Text>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: 100,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  heroCard: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: 6,
  },
  heroEyebrow: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.brandDeep,
    letterSpacing: 1.2,
  },
  heroTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  heroBody: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 19,
    marginTop: 4,
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
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
    ...shadows.card,
  },
  stepCardDone: {
    borderColor: colors.brandMid,
    backgroundColor: colors.brandSoft,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumDone: {
    backgroundColor: colors.brandDeep,
  },
  stepNumText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.textPrimary,
  },
  stepTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  stepDetail: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginTop: 2,
  },
  brandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  brandPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandPillSelected: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  brandPillText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.textPrimary,
  },
  brandPillTextSelected: {
    color: colors.textInverse,
  },
  footnote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    lineHeight: 16,
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
});
