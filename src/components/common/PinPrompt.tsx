import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';

// Bottom-sheet PIN entry. Used in two modes:
//   • `mode='set'`     — first-time setup: user picks a new PIN, then
//                        confirms it. Returns the chosen PIN to onSubmit.
//   • `mode='verify'`  — guard mode: user types their PIN. We validate
//                        externally (via verifyPin) and onSubmit is
//                        called with the raw entry so the caller can
//                        decide what to do on mismatch.
//
// Why a custom sheet instead of Alert.prompt: Alert.prompt is iOS-only,
// and Android's stock IME for numeric input doesn't auto-advance. We
// also want to drop the modal stack visibly when the SOS is being
// cancelled so the user can't second-guess.

export type PinPromptProps = {
  visible: boolean;
  mode: 'set' | 'verify';
  title?: string;
  body?: string;
  onCancel: () => void;
  onSubmit: (pin: string) => void | Promise<void>;
  errorText?: string | null;
};

const PIN_LEN = 4;

export function PinPrompt({
  visible,
  mode,
  title,
  body,
  onCancel,
  onSubmit,
  errorText,
}: PinPromptProps) {
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const enter = useRef(new Animated.Value(0)).current;
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    Animated.timing(enter, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    if (visible) {
      setPin('');
      setConfirm('');
      setStage('enter');
      // expo / RN modals don't autofocus the field on Android reliably.
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [visible, enter]);

  const handleNext = async (value: string) => {
    if (mode === 'set' && stage === 'enter') {
      setPin(value);
      setStage('confirm');
      setConfirm('');
      setTimeout(() => inputRef.current?.focus(), 50);
      return;
    }
    if (mode === 'set' && stage === 'confirm') {
      if (value !== pin) {
        setConfirm('');
        // The parent owns errorText; we just bounce the entry.
        return;
      }
      await onSubmit(value);
      return;
    }
    // verify mode
    await onSubmit(value);
  };

  const activeValue = stage === 'enter' ? pin : confirm;
  const handleChange = (next: string) => {
    const digits = next.replace(/\D/g, '').slice(0, PIN_LEN);
    if (stage === 'enter') setPin(digits);
    else setConfirm(digits);
    if (digits.length === PIN_LEN) {
      handleNext(digits);
    }
  };

  const heading =
    title ??
    (mode === 'set'
      ? stage === 'enter'
        ? 'Set your safety PIN'
        : 'Confirm your PIN'
      : 'Enter your safety PIN');

  const subline =
    body ??
    (mode === 'set'
      ? stage === 'enter'
        ? 'A 4-digit code you\'ll use to cancel an SOS. Keep it secret.'
        : 'Type it again to make sure it sticks.'
      : 'Required to cancel an active SOS.');

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [40, 0],
  });

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      onRequestClose={onCancel}
      // Android: focusing from the `visible` effect races the modal window
      // being attached, so the number pad never opens when the prompt is
      // rendered already-visible (the mandatory PIN setup screen). onShow fires
      // once the window really exists.
      onShow={() => setTimeout(() => inputRef.current?.focus(), 60)}
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Animated.View
          style={[
            styles.sheet,
            { opacity: enter, transform: [{ translateY }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Ionicons
              name="shield-checkmark"
              size={22}
              color={colors.brandDeep}
            />
          </View>
          <Text style={styles.title}>{heading}</Text>
          <Text style={styles.body}>{subline}</Text>

          <TextInput
            ref={inputRef}
            value={activeValue}
            onChangeText={handleChange}
            keyboardType="number-pad"
            maxLength={PIN_LEN}
            secureTextEntry
            style={styles.invisible}
            autoFocus
          />

          {/* Tapping the dots re-opens the number pad. Without this, a user who
              dismisses the keyboard is stuck staring at a PIN box she cannot
              type into — and on the mandatory setup screen, stuck for good. */}
          <Pressable
            style={styles.dotsRow}
            onPress={() => inputRef.current?.focus()}
            accessibilityRole="button"
            accessibilityLabel="Enter your PIN"
            hitSlop={16}
          >
            {Array.from({ length: PIN_LEN }).map((_, i) => {
              const filled = i < activeValue.length;
              return (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    filled && styles.dotFilled,
                    !!errorText && styles.dotError,
                  ]}
                />
              );
            })}
          </Pressable>

          {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

          <Pressable
            onPress={onCancel}
            hitSlop={8}
            style={({ pressed }) => [
              styles.cancelBtn,
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: spacing.lg,
    paddingTop: 12,
    paddingBottom: spacing.xl + 12,
    alignItems: 'center',
    gap: spacing.sm,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.10)',
    marginBottom: spacing.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  body: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginTop: 2,
  },
  invisible: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: spacing.lg,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  dotFilled: {
    borderColor: colors.brandDeep,
    backgroundColor: colors.brandDeep,
  },
  dotError: {
    borderColor: colors.error,
    backgroundColor: colors.error,
  },
  error: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.error,
    marginTop: spacing.sm,
  },
  cancelBtn: {
    marginTop: spacing.lg,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.circle,
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
  cancelText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    color: colors.textSecondary,
  },
});
