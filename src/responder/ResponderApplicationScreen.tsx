import React, { useCallback, useState } from 'react';
import { appAlert } from '@/components/common';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { loadHelperProfile, type HelperProfile } from '@/services/helper-profile';
import { applyAsResponder } from '@/services/roles';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

// Responder verification is PAUSED until ORBII can handle government ID
// (Aadhaar / PAN) legally and securely — collecting identity documents without
// the right legal footing and data handling is not something we will ship on a
// safety app. Flip this to true only once that pipeline is properly in place.
// Existing applicants and approved responders keep their status; this only
// stops NEW applications from being filed.
const APPLICATIONS_OPEN = false;

const DOES = [
  { icon: 'walk', text: 'Reach people in danger nearby, safely.' },
  { icon: 'call', text: 'Call the police and become a visible presence.' },
  { icon: 'heart', text: 'Assist the victim until police or family arrive.' },
];
const REQUIREMENTS = [
  '18+ with a valid Aadhaar & PAN',
  'A working phone with location on',
  'Willing to complete a short safety training',
  'Agree to never confront or use force',
];

// Become an ORBII Responder — intro + requirements + apply. Applying creates a
// pending application; an admin approves, and the account's role flips to
// 'responder' (which unlocks the Missions tab). Same app, same account.
export function ResponderApplicationScreen() {
  const navigation = useNavigation<Nav>();
  const profile = useAppSelector((s) => s.user.profile);
  const role = profile?.role ?? 'user';
  const [hp, setHp] = useState<HelperProfile | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!profile?.uid) return;
        try {
          const p = await loadHelperProfile(profile.uid);
          if (alive) setHp(p);
        } catch {
          if (alive) setHp(null); // reported inside; treat as "not applied yet"
        }
      })();
      return () => {
        alive = false;
      };
    }, [profile?.uid]),
  );

  const applied = hp?.verificationStatus === 'pending' || role === 'responder';

  // Applying is step one. Step two is uploading Aadhaar / PAN / a selfie, which
  // is the screen people were never taken to: the old code filed the
  // application, re-read the profile, and if THAT read failed it swallowed the
  // error and left the button sitting there. Nothing on screen ever moved, so
  // it looked like the button did nothing. Now the RPC succeeding is enough to
  // move you forward; the profile read is only a nicety.
  const apply = async () => {
    if (submitting) return;
    if (!APPLICATIONS_OPEN) {
      appAlert(
        'Responder verification is opening soon',
        "We're putting the legal and identity checks in place first, so responder sign-ups are paused for now. Voice SOS and alerts to your circle work as normal. We'll open this the moment it's ready.",
      );
      return;
    }
    setSubmitting(true);
    const res = await applyAsResponder();
    if (!res.ok) {
      setSubmitting(false);
      // Say what actually went wrong. Blaming the user's connection for a
      // server-side problem is how this bug stayed invisible.
      appAlert('Could not submit', res.error);
      return;
    }
    if (profile?.uid) {
      try {
        setHp(await loadHelperProfile(profile.uid));
      } catch {
        // Application is filed regardless; the verification screen re-reads it.
      }
    }
    setSubmitting(false);
    navigation.navigate('ResponderVerification');
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Become a Responder</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Ionicons name="shield-checkmark" size={28} color={colors.sageDeep} />
            </View>
            <Text style={styles.heroTitle}>Help save lives near you</Text>
            <Text style={styles.heroSub}>
              ORBII Responders are verified people who can reach an emergency
              faster than anyone else. This is about protecting people — not money.
            </Text>
          </View>

          {applied ? (
            <View style={styles.appliedCard}>
              <Ionicons name="hourglass" size={22} color={colors.peachDeep} />
              <View style={{ flex: 1 }}>
                <Text style={styles.appliedTitle}>
                  {role === 'responder' ? "You're a verified responder" : 'Application under review'}
                </Text>
                <Text style={styles.appliedBody}>
                  {role === 'responder'
                    ? 'Open the Missions tab to go online and respond.'
                    : "We're reviewing your application. You'll get the Missions tab once approved."}
                </Text>
              </View>
            </View>
          ) : null}

          <Text style={styles.sectionLabel}>WHAT A RESPONDER DOES</Text>
          <View style={styles.card}>
            {DOES.map((d, i) => (
              <View key={i} style={[styles.doRow, i > 0 && styles.divider]}>
                <Ionicons name={d.icon as never} size={18} color={colors.sageDeep} />
                <Text style={styles.doText}>{d.text}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionLabel}>REQUIREMENTS</Text>
          <View style={styles.card}>
            {REQUIREMENTS.map((r, i) => (
              <View key={i} style={[styles.doRow, i > 0 && styles.divider]}>
                <Ionicons name="checkmark-circle" size={18} color={colors.sageDeep} />
                <Text style={styles.doText}>{r}</Text>
              </View>
            ))}
          </View>

          <View style={styles.note}>
            <Ionicons name="information-circle" size={16} color={colors.lavenderDeep} />
            <Text style={styles.noteText}>
              {APPLICATIONS_OPEN
                ? "After applying you'll complete identity verification and a short training. An ORBII admin reviews every responder before approval."
                : "Responder sign-ups are paused while we put the identity and legal checks in place. Your Voice SOS and circle alerts work as normal in the meantime."}
            </Text>
          </View>
        </ScrollView>

        {!applied && !APPLICATIONS_OPEN ? (
          <View style={styles.footer}>
            <View style={styles.locked}>
              <Ionicons name="lock-closed" size={16} color={colors.textMuted} />
              <Text style={styles.lockedText}>Verification opening soon</Text>
            </View>
          </View>
        ) : !applied ? (
          <View style={styles.footer}>
            <Pressable
              onPress={apply}
              disabled={submitting}
              style={({ pressed }) => [styles.cta, (submitting || pressed) && { opacity: 0.85 }]}
            >
              <Text style={styles.ctaText}>{submitting ? 'Submitting…' : 'Apply to become a Responder'}</Text>
            </Pressable>
          </View>
        ) : role !== 'responder' ? (
          <View style={styles.footer}>
            <Pressable
              onPress={() => navigation.navigate('ResponderVerification')}
              style={styles.ctaSecondary}
            >
              <Text style={styles.ctaSecondaryText}>Continue verification</Text>
            </Pressable>
          </View>
        ) : null}
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
  heroSub: { ...typography.body, fontSize: 13.5, color: colors.textSecondary, textAlign: 'center', maxWidth: 320 },
  appliedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.peachSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
  },
  appliedTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  appliedBody: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1, lineHeight: 16 },
  sectionLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11, letterSpacing: 0.8, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, paddingHorizontal: spacing.md, ...shadows.card },
  doRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.divider },
  doText: { flex: 1, ...typography.bodyMedium, fontSize: 14, color: colors.textPrimary },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.lavenderSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  noteText: { flex: 1, ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, paddingTop: spacing.sm },
  cta: { backgroundColor: colors.sage, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center' },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.creamDeep,
    borderRadius: radius.pill,
    paddingVertical: 16,
  },
  lockedText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textMuted },
  ctaText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  ctaSecondary: { backgroundColor: colors.surface, borderRadius: radius.pill, paddingVertical: 16, alignItems: 'center', ...shadows.card },
  ctaSecondaryText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
});
