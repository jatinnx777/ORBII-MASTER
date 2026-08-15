import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { getItem, setItem } from '@/services/storage';
import { isHelperModeRunning, startHelperMode, stopHelperMode } from '@/services/helper-mode';
import { trackEvent } from '@/services/analytics';

// Community Guardian (Path B): any user can opt in to be reachable when someone
// nearby fires an SOS, no verification, no KYC. This grows the "someone close
// can come" pool from day one. It is deliberately framed and consent-gated:
// guardians are volunteers, not vetted responders, their job is presence and
// calling 112, never confrontation, and they must accept that before going on.

const CONSENT_KEY = 'orbii:guardian-consent';

const RULES = [
  { icon: 'walk', text: 'Reach the person safely and be a visible presence.' },
  { icon: 'call', text: 'Call 112. Getting the police there is the goal.' },
  { icon: 'hand-left', text: 'Never confront or use force. Presence, not combat.' },
  { icon: 'lock-closed', text: 'Respect their privacy. What you see stays private.' },
];

export function CommunityGuardianScreen() {
  const navigation = useNavigation();
  const [consented, setConsented] = useState(false);
  const [online, setOnline] = useState(isHelperModeRunning());
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const c = await getItem<boolean>(CONSENT_KEY);
        if (alive) setConsented(!!c);
        if (alive) setOnline(isHelperModeRunning());
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const accept = async () => {
    await setItem(CONSENT_KEY, true);
    setConsented(true);
  };

  const toggle = async (next: boolean) => {
    if (busy) return;
    if (next) {
      // Guardians must share location to be reachable. Ask up front.
      const { granted } = await Location.requestForegroundPermissionsAsync();
      if (!granted) {
        appAlert(
          'Location needed',
          'To be reachable when someone nearby needs help, ORBII needs your location while you are a guardian. You can turn this off any time.',
        );
        return;
      }
    }
    setBusy(true);
    try {
      if (next) {
        await startHelperMode();
        trackEvent('setup_protection_activated', { via: 'guardian' });
      } else {
        await stopHelperMode();
      }
      setOnline(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Community Guardian</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="people" size={26} color={colors.sageDeep} />
            </View>
            <Text style={styles.heroTitle}>Be someone's nearby help</Text>
            <Text style={styles.heroSub}>
              When you're a guardian and online, you're alerted if someone close by fires an SOS, so
              a real person can reach them fast. No verification needed. This is about showing up.
            </Text>
          </View>

          <Text style={styles.sectionLabel}>THE RULES, ALWAYS</Text>
          <View style={styles.card}>
            {RULES.map((r, i) => (
              <View key={i} style={[styles.ruleRow, i > 0 && styles.divider]}>
                <Ionicons name={r.icon as never} size={18} color={colors.sageDeep} />
                <Text style={styles.ruleText}>{r.text}</Text>
              </View>
            ))}
          </View>

          {!consented ? (
            <Pressable onPress={accept} style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
              <Text style={styles.ctaText}>I understand, I'll help safely</Text>
            </Pressable>
          ) : (
            <View style={[styles.statusCard, online && styles.statusOn]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.statusLabel, online && { color: colors.sageDeep }]}>
                  {online ? "You're a guardian, online" : 'Guardian, currently off'}
                </Text>
                <Text style={styles.statusSub}>
                  {online
                    ? 'You may be alerted if someone nearby needs help.'
                    : 'Turn on to be reachable for nearby emergencies.'}
                </Text>
              </View>
              <Switch
                value={online}
                onValueChange={toggle}
                disabled={busy}
                trackColor={{ false: colors.border, true: colors.sageSoft }}
                thumbColor={online ? colors.sage : colors.surface}
              />
            </View>
          )}

          <Text style={styles.footnote}>
            Guardians are volunteers, not verified responders, so alerts to them carry a person's
            location. Only turn this on if you genuinely intend to help, and never misuse what you
            see. For guaranteed, vetted, accountable help, that's the verified responder network.
          </Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
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
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },

  hero: { alignItems: 'center', gap: 6, paddingVertical: spacing.sm },
  heroIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  heroTitle: { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  heroSub: { ...typography.body, fontSize: 13.5, lineHeight: 20, color: colors.textSecondary, textAlign: 'center', maxWidth: 330 },

  sectionLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.md, ...shadows.card },
  ruleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  ruleText: { flex: 1, ...typography.bodyMedium, fontSize: 14, color: colors.textPrimary },

  cta: { backgroundColor: colors.sage, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center' },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textInverse },
  pressed: { opacity: 0.9 },

  statusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    ...shadows.card,
  },
  statusOn: { backgroundColor: colors.sageSoft },
  statusLabel: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textPrimary },
  statusSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 2, maxWidth: 220 },

  footnote: { ...typography.caption, fontSize: 11.5, lineHeight: 17, color: colors.textMuted, paddingHorizontal: spacing.xs, marginTop: spacing.xs },
});
