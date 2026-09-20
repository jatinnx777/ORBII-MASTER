import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, fontFamilies, radius } from '@/theme';
import { ageFromDob, setDeclaredDob, type AgeStatus } from '@/services/consent';

/**
 * Asked ONCE, the first time somebody reaches an 18+ feature with no stored
 * date of birth. Everyone who signed up before the field existed lands here,
 * which is the whole reason it exists: the alternative was reading "we never
 * asked" as "under 18" and locking adults out of their own location sharing.
 * The answer is stored, so it never appears twice.
 *
 * STYLED TO MATCH ONBOARDING, which means the same rules as Step.tsx:
 *
 *   - Flat near-white ground, not a white card on a dim backdrop.
 *   - One large heading carrying the screen, left aligned, tight.
 *   - A grey sentence under it and nothing else competing.
 *   - The icon badge is gone. A calendar in a lavender circle was decoration
 *     on a question that is one line long, and decoration is what made this
 *     sheet feel like a different app from the flow it interrupts.
 *   - One full width pill at the bottom, ORBII lavender, pale tint when not
 *     ready rather than a faded dark button.
 *
 * It stays a sheet rather than becoming a screen: it interrupts the map, and
 * a person who opened the map to see where somebody is should still be able to
 * see the map behind the question.
 */

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

        <Text style={styles.title}>Your date of birth</Text>
        <Text style={styles.sub}>
          Indian law does not let us share live location for anyone under 18, so we have to ask
          once. We remember the answer and will not ask again.
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

        {/* The answer to "what happens if I am under 18" is given before she
            answers, not after, so declaring it honestly never feels like a
            trap. */}
        <Text style={[styles.hint, age !== null && age < 18 && styles.hintWarn]}>
          {ready
            ? age! < 18
              ? `You are ${age}. Live location stays off. Voice SOS, circle alerts and 112 work exactly as normal.`
              : `You are ${age}.`
            : 'Your safety features work either way.'}
        </Text>

        <Pressable
          onPress={confirm}
          disabled={!ready || busy}
          style={[styles.cta, (!ready || busy) && styles.ctaOff]}
          accessibilityRole="button"
          accessibilityState={{ disabled: !ready || busy }}
        >
          <Text style={styles.ctaText}>{busy ? 'One moment' : 'Continue'}</Text>
        </Pressable>

        <Pressable onPress={onCancel} style={styles.skip} accessibilityRole="button">
          <Text style={styles.skipText}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Same ground as the onboarding steps, so the two never read as two apps. */
const GROUND = '#F7F6F2';

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(16,14,20,0.42)' },
  sheet: {
    backgroundColor: GROUND,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingTop: 10,
    paddingBottom: 34,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(23,22,28,0.12)',
    alignSelf: 'center',
    marginBottom: 22,
  },

  // Smaller than a full step's 40pt, because a sheet is not a screen and this
  // one has a keyboard under it, but the same weight and the same tight
  // tracking so it belongs to the same family.
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -1,
    color: colors.textPrimary,
  },
  sub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 16,
    lineHeight: 23,
    color: colors.textSecondary,
    marginTop: 10,
  },

  input: {
    marginTop: 24,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: '#ECEAE4',
    paddingHorizontal: 18,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 19,
    letterSpacing: 1.5,
    color: colors.textPrimary,
  },
  hint: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textMuted,
    marginTop: 10,
    paddingHorizontal: 4,
  },
  hintWarn: { color: colors.brandDeep },

  cta: {
    marginTop: 22,
    height: 62,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A pale tint of the same colour, not a faded dark button. Not ready, rather
  // than broken.
  ctaOff: { backgroundColor: '#D9D0F0' },
  ctaText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 17.5,
    color: colors.textInverse,
  },

  skip: { marginTop: 10, alignItems: 'center', paddingVertical: 10 },
  skipText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 15,
    color: colors.textMuted,
  },
});
