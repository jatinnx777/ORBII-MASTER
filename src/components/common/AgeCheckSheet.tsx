import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { ageFromDob, setDeclaredDob, type AgeStatus } from '@/services/consent';

// Asked ONCE, the first time someone reaches an 18+ feature without a stored
// date of birth. Everyone who signed up before the DOB field existed lands here,
// which is why it exists at all: the alternative was treating "we never asked"
// as "under 18" and locking adults out of their own location sharing.
//
// The answer is stored, so this never appears a second time.

export function AgeCheckSheet({
  visible,
  onResolved,
  onCancel,
}: {
  visible: boolean;
  /** Fires with the stored status once a valid date is entered. */
  onResolved: (status: AgeStatus) => void;
  onCancel: () => void;
}) {
  const [dob, setDob] = useState('');
  const [busy, setBusy] = useState(false);

  const digits = dob.replace(/\D/g, '').slice(0, 8);
  const parts = useMemo(() => {
    const d = parseInt(digits.slice(0, 2), 10);
    const m = parseInt(digits.slice(2, 4), 10);
    const y = parseInt(digits.slice(4, 8), 10);
    return { d, m, y };
  }, [digits]);
  const age = digits.length === 8 ? ageFromDob(parts.d, parts.m, parts.y) : null;
  const ready = digits.length === 8 && age !== null && age >= 0 && age < 120;

  // Render as DD / MM / YYYY while they type, without fighting the keyboard.
  const pretty = useMemo(() => {
    const a = digits.slice(0, 2);
    const b = digits.slice(2, 4);
    const c = digits.slice(4, 8);
    return [a, b, c].filter(Boolean).join(' / ');
  }, [digits]);

  const confirm = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const status = await setDeclaredDob(parts.d, parts.m, parts.y);
      setDob('');
      onResolved(status);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel} />
      <View style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.iconWrap}>
          <Ionicons name="calendar-outline" size={22} color={colors.brandDeep} />
        </View>
        <Text style={styles.title}>One quick thing</Text>
        <Text style={styles.sub}>
          Indian law does not let us share live location for anyone under 18, so we have to ask your
          date of birth once. We remember it, and you will not be asked again.
        </Text>

        <TextInput
          value={pretty}
          onChangeText={setDob}
          placeholder="DD / MM / YYYY"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          style={styles.input}
          maxLength={14}
          autoFocus
        />
        {digits.length === 8 && age !== null && age >= 0 && age < 120 ? (
          <Text style={[styles.hint, age < 18 && styles.hintWarn]}>
            {age < 18
              ? `You are ${age}. Live location stays off, but Voice SOS, circle alerts and 112 all work as normal.`
              : `You are ${age}. All set.`}
          </Text>
        ) : (
          <Text style={styles.hint}>Your safety features work either way.</Text>
        )}

        <Pressable
          onPress={confirm}
          disabled={!ready || busy}
          style={[styles.cta, (!ready || busy) && styles.ctaOff]}
          accessibilityRole="button"
        >
          <Text style={styles.ctaText}>{busy ? 'Saving…' : 'Continue'}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.skip} accessibilityRole="button">
          <Text style={styles.skipText}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,14,20,0.42)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl + spacing.md,
    ...shadows.sheet,
  },
  grabber: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.creamDeep, alignSelf: 'center', marginBottom: spacing.md,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm,
  },
  title: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 20, color: colors.textPrimary },
  sub: {
    fontFamily: fontFamilies.poppinsRegular, fontSize: 13.5, lineHeight: 20,
    color: colors.textMuted, marginTop: 6,
  },
  input: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.cream,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17,
    letterSpacing: 1,
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: fontFamilies.poppinsRegular, fontSize: 12.5, lineHeight: 18,
    color: colors.textMuted, marginTop: spacing.sm,
  },
  hintWarn: { color: colors.brandDeep },
  cta: {
    marginTop: spacing.lg,
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaOff: { opacity: 0.4 },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15.5, color: colors.textInverse },
  skip: { marginTop: spacing.sm, alignItems: 'center', paddingVertical: 8 },
  skipText: { fontFamily: fontFamilies.poppinsRegular, fontSize: 13.5, color: colors.textMuted },
});
