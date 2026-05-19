import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PinPrompt } from '@/components/common';
import {
  clearPin,
  isPinSet,
  setPin,
  verifyPin,
} from '@/services/safety-pin';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import type { AppScreenProps } from '@/navigation/types';

// Safety PIN management. The PIN itself is stored in SecureStore as a
// FNV hash (see services/safety-pin.ts). This screen is just the user-
// facing surface: see current state, set a new PIN, or remove it.

export function SafetyPinScreen({ navigation }: AppScreenProps<'SafetyPin'>) {
  const [loading, setLoading] = useState(true);
  const [hasPin, setHasPin] = useState(false);
  const [setSheetOpen, setSetSheetOpen] = useState(false);
  const [verifySheetOpen, setVerifySheetOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'set' | 'clear' | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const v = await isPinSet();
    setHasPin(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onChangePin = () => {
    setPinError(null);
    if (hasPin) {
      setPendingAction('set');
      setVerifySheetOpen(true);
    } else {
      setSetSheetOpen(true);
    }
  };

  const onRemovePin = () => {
    setPinError(null);
    setPendingAction('clear');
    setVerifySheetOpen(true);
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
          >
            <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Safety PIN</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.body}>
          <View style={styles.heroIcon}>
            <Ionicons name="shield-checkmark" size={28} color={colors.brandDeep} />
          </View>
          <Text style={styles.heroTitle}>
            {hasPin ? 'Safety PIN is on' : 'Add a safety PIN'}
          </Text>
          <Text style={styles.heroBody}>
            A 4-digit code you'll need to cancel an active SOS. Stops an attacker
            who grabbed your phone from silently dismissing the alert.
          </Text>

          {loading ? (
            <View style={{ marginTop: spacing.lg }}>
              <ActivityIndicator color={colors.brandDeep} />
            </View>
          ) : (
            <View style={styles.actions}>
              <Pressable
                onPress={onChangePin}
                style={({ pressed }) => [
                  styles.primary,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Ionicons
                  name={hasPin ? 'key' : 'add'}
                  size={16}
                  color={colors.textInverse}
                />
                <Text style={styles.primaryText}>
                  {hasPin ? 'Change PIN' : 'Set up PIN'}
                </Text>
              </Pressable>
              {hasPin ? (
                <Pressable
                  onPress={onRemovePin}
                  style={({ pressed }) => [
                    styles.danger,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color={colors.error}
                  />
                  <Text style={styles.dangerText}>Remove PIN</Text>
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </SafeAreaView>

      <PinPrompt
        visible={setSheetOpen}
        mode="set"
        errorText={pinError}
        onCancel={() => setSetSheetOpen(false)}
        onSubmit={async (pin) => {
          try {
            await setPin(pin);
            setSetSheetOpen(false);
            await refresh();
            Alert.alert('PIN saved', 'Your safety PIN is active.');
          } catch (err) {
            setPinError(err instanceof Error ? err.message : 'Could not save PIN.');
          }
        }}
      />

      <PinPrompt
        visible={verifySheetOpen}
        mode="verify"
        title="Confirm with your current PIN"
        body="Enter your existing PIN to continue."
        errorText={pinError}
        onCancel={() => {
          setVerifySheetOpen(false);
          setPendingAction(null);
          setPinError(null);
        }}
        onSubmit={async (pin) => {
          const ok = await verifyPin(pin);
          if (!ok) {
            setPinError('Wrong PIN. Try again.');
            return;
          }
          setVerifySheetOpen(false);
          setPinError(null);
          if (pendingAction === 'clear') {
            await clearPin();
            await refresh();
            Alert.alert('PIN removed', 'Cancelling an SOS no longer needs a PIN.');
          } else if (pendingAction === 'set') {
            setSetSheetOpen(true);
          }
          setPendingAction(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  heroBody: {
    ...typography.body,
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
    marginTop: spacing.sm,
  },
  actions: {
    marginTop: spacing.xl,
    width: '100%',
    gap: spacing.sm,
  },
  primary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.brandDeep,
    ...shadows.card,
  },
  primaryText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.textInverse,
    letterSpacing: 0.2,
  },
  danger: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,77,77,0.25)',
  },
  dangerText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: colors.error,
    letterSpacing: 0.2,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
});
