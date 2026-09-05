import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { joinCircleByCode } from '@/services/circles';

/**
 * Enter six letters, join a circle.
 *
 * SIX BOXES FED BY ONE HIDDEN INPUT, for the same reason as the sign-in code:
 * six real fields means six refs, focus juggling and a backspace that has to
 * guess which box it belongs to, and it falls apart the moment somebody pastes
 * a code out of WhatsApp. One transparent input across the row makes paste and
 * backspace ordinary text editing.
 *
 * LETTERS ONLY, upper-cased as they arrive, and the alphabet has no I, O, Q or
 * S in it (sql/125). Somebody reading a code over the phone will say "oh" for
 * a zero, and this is where that gets caught rather than at the server.
 */

const LEN = 6;

export function JoinByCodeSheet({
  visible,
  onClose,
  onJoined,
}: {
  visible: boolean;
  onClose: () => void;
  onJoined: (circleId: string) => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  const reset = useCallback(() => {
    setCode('');
    setError(null);
    setBusy(false);
  }, []);

  const submit = useCallback(async () => {
    if (code.length < LEN || busy) return;
    setBusy(true);
    setError(null);
    try {
      const id = await joinCircleByCode(code);
      if (!id) {
        // A code that matches nothing comes back null rather than throwing, so
        // a typo reads as a typo and not as a failure of the app.
        setError('No circle has that code. Check the letters and try again.');
        setCode('');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      reset();
      onJoined(id);
    } catch (e) {
      // The server's sentences are the useful ones here: the circle is full,
      // you were removed from it, too many attempts. Each needs a different
      // response from the person reading it.
      setError(e instanceof Error ? e.message : 'Could not join. Try again.');
    } finally {
      setBusy(false);
    }
  }, [code, busy, onJoined, reset]);

  const chars = code.split('');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.sheet}>
          <View style={s.grabber} />

          <Text style={s.title}>Join a circle</Text>
          <Text style={s.blurb}>
            Ask them for their six letter code. There is no way to search for people on ORBII.
          </Text>

          <Pressable
            onPress={() => inputRef.current?.focus()}
            style={s.boxRow}
            accessibilityLabel={`Join code, ${chars.length} of ${LEN} letters entered`}
          >
            {Array.from({ length: LEN }).map((_, i) => (
              <View
                key={i}
                style={[
                  s.box,
                  i < chars.length && s.boxFilled,
                  i === chars.length && s.boxNext,
                  !!error && s.boxError,
                ]}
              >
                <Text style={s.boxText}>{chars[i] ?? ''}</Text>
              </View>
            ))}
            <TextInput
              ref={inputRef}
              value={code}
              onChangeText={(t) => {
                setError(null);
                // Letters only. A pasted code often arrives with a space or a
                // dash in the middle from however it was written down.
                setCode(t.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, LEN));
              }}
              autoFocus={visible}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={LEN}
              style={s.hidden}
              caretHidden
              onSubmitEditing={() => void submit()}
            />
          </Pressable>

          {error ? (
            <View style={s.errorRow}>
              <Ionicons name="alert-circle" size={14} color={colors.coralDeep} />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void submit()}
            disabled={code.length < LEN || busy}
            style={({ pressed }) => [
              s.cta,
              (code.length < LEN || busy) && s.ctaOff,
              pressed && { transform: [{ scale: 0.98 }] },
            ]}
            accessibilityRole="button"
          >
            {busy ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={s.ctaText}>Join</Text>
            )}
          </Pressable>

          <Pressable onPress={onClose} style={s.cancel}>
            <Text style={s.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(23,22,28,0.42)' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.divider,
    marginBottom: spacing.xs,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    letterSpacing: -0.4,
    color: colors.textPrimary,
  },
  blurb: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },

  boxRow: { flexDirection: 'row', gap: 8, justifyContent: 'center', marginVertical: spacing.sm },
  box: {
    width: 46,
    height: 58,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  boxFilled: { borderColor: 'rgba(110,88,182,0.28)' },
  boxNext: { borderColor: colors.brandDeep },
  boxError: { borderColor: colors.coralDeep },
  boxText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  hidden: { ...StyleSheet.absoluteFillObject, opacity: 0, fontSize: 1 },

  errorRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  errorText: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 13,
    color: colors.coralDeep,
  },

  cta: {
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaOff: { backgroundColor: colors.creamDeep },
  ctaText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16, color: colors.textInverse },
  cancel: { alignItems: 'center', paddingVertical: spacing.xs },
  cancelText: { fontFamily: fontFamilies.interMedium, fontSize: 14, color: colors.textSecondary },
});

export default JoinByCodeSheet;
