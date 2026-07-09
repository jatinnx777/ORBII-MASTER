import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mascot, PinPrompt } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { setPin } from '@/services/safety-pin';

// Mandatory, one-time safety PIN — collected at registration and never again.
//
// It exists for one moment: an attacker has her phone, ORBII heard her
// emergency phrase, and the 5-second countdown is running. Without a PIN he
// simply taps Cancel. With one, he can't.
//
// It cannot be skipped (there is no dismiss) and cannot be changed later
// (setPin is write-once) — a PIN an attacker can change is not a PIN.

export function SafetyPinSetupScreen({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.body}>
          <Mascot pose="shield" size={150} />
          <Text style={styles.title}>Set your safety PIN</Text>
          <Text style={styles.sub}>
            If someone takes your phone during an emergency, this 4-digit PIN is
            what stops them cancelling your SOS.
          </Text>

          <View style={styles.noteCard}>
            <Ionicons name="lock-closed" size={18} color={colors.coralDeep} />
            <Text style={styles.noteText}>
              Choose carefully. Your PIN{' '}
              <Text style={styles.noteBold}>can never be changed</Text> and is
              never sent off your phone. Don't share it with anyone.
            </Text>
          </View>
        </View>
      </SafeAreaView>

      {/* No dismiss: this screen is the gate. */}
      <PinPrompt
        visible
        mode="set"
        title="Create your safety PIN"
        body="You'll enter this to cancel an SOS you didn't mean to send."
        errorText={error}
        onCancel={() => setError('Your safety PIN is required to continue.')}
        onSubmit={async (pin) => {
          try {
            await setPin(pin);
            onDone();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save your PIN.');
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 26,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
    letterSpacing: -0.4,
  },
  sub: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 14.5,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 330,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.xl,
    padding: spacing.md,
    marginTop: spacing.lg,
    ...shadows.icon,
  },
  noteText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  noteBold: { fontFamily: fontFamilies.poppinsBold },
});
