import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button, Input, ScreenContainer } from '@/components/common';
import { colors, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  otpSendFailed,
  otpSendStarted,
  otpSendSucceeded,
} from '@/redux/slices/userSlice';
import { sendOtp, DEV_AUTH } from '@/services/auth';
import { formatPhoneForDisplay, isValidIndianPhone } from '@/utils/validation';
import type { AuthScreenProps } from '@/navigation/types';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const isSending = status === 'sending_otp';

  const [phoneInput, setPhoneInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const rawDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const canSubmit = isValidIndianPhone(rawDigits) && !isSending;

  const handleChange = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 10);
    setPhoneInput(formatPhoneForDisplay(next));
    if (localError) setLocalError(null);
  };

  const handleSubmit = async () => {
    if (!canSubmit) {
      setLocalError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    dispatch(otpSendStarted({ phone: rawDigits }));
    try {
      const { verificationId } = await sendOtp(rawDigits);
      dispatch(otpSendSucceeded({ verificationId }));
      navigation.navigate('OTP', { phone: rawDigits });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not send OTP.';
      dispatch(otpSendFailed({ error: message }));
      Alert.alert('Could not send OTP', message);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.header}>
        <Text style={styles.brand}>ORBII</Text>
        <Text style={styles.tagline}>Help arrives in 2 minutes.</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>Enter your mobile number</Text>
        <Text style={styles.subtitle}>
          We'll text you a 6-digit code to verify it's you.
        </Text>

        <Input
          label="Mobile number"
          keyboardType="number-pad"
          autoFocus
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={11}
          value={phoneInput}
          onChangeText={handleChange}
          placeholder="98765 43210"
          leftAdornment={<Text style={styles.countryCode}>+91</Text>}
          error={localError ?? undefined}
          hint={
            DEV_AUTH.enabled
              ? `Dev mode — any valid number works. OTP is ${DEV_AUTH.otp}.`
              : 'Standard SMS rates may apply.'
          }
          containerStyle={styles.input}
        />

        <Button
          label="Send OTP"
          onPress={handleSubmit}
          loading={isSending}
          disabled={!canSubmit}
          style={styles.submit}
        />

        <Text style={styles.terms}>
          By continuing you agree to ORBII's Terms and Privacy Policy.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.xxl,
  },
  brand: {
    ...typography.h1,
    color: colors.primary,
    letterSpacing: 2,
  },
  tagline: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  body: {
    flex: 1,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  input: {
    marginBottom: spacing.lg,
  },
  countryCode: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  submit: {
    marginTop: spacing.sm,
  },
  terms: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
