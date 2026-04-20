import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  Button,
  Input,
  PrivacyPolicyModal,
  ScreenContainer,
} from '@/components/common';
import { colors, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  otpSendFailed,
  otpSendStarted,
  otpSendSucceeded,
} from '@/redux/slices/userSlice';
import { policyAccepted } from '@/redux/slices/appSlice';
import { sendOtp, DEV_AUTH } from '@/services/auth';
import { formatPhoneForDisplay, isValidIndianPhone } from '@/utils/validation';
import type { AuthScreenProps } from '@/navigation/types';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSending = status === 'sending_otp';

  const [phoneInput, setPhoneInput] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);

  const rawDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const phoneValid = isValidIndianPhone(rawDigits);
  const policyOk = policyAcceptedAt !== null;
  const canSubmit = phoneValid && policyOk && !isSending;

  const handleChange = (value: string) => {
    const next = value.replace(/\D/g, '').slice(0, 10);
    setPhoneInput(formatPhoneForDisplay(next));
    if (localError) setLocalError(null);
  };

  const handleSubmit = async () => {
    if (!phoneValid) {
      setLocalError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (!policyOk) {
      setPolicyOpen(true);
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

  const handleCheckboxPress = () => {
    if (policyOk) {
      setPolicyOpen(true);
      return;
    }
    setPolicyOpen(true);
  };

  const handleAccept = () => {
    dispatch(policyAccepted());
    setPolicyOpen(false);
  };

  const handleDecline = () => {
    setPolicyOpen(false);
    Alert.alert(
      'Policy required',
      'ORBII needs your consent to create an account. You can review the policy anytime from Profile → Settings.',
    );
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

        <Pressable
          onPress={handleCheckboxPress}
          style={styles.policyRow}
          hitSlop={8}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: policyOk }}
        >
          <View style={[styles.checkbox, policyOk && styles.checkboxChecked]}>
            {policyOk ? (
              <Ionicons
                name="checkmark"
                size={14}
                color={colors.textInverse}
              />
            ) : null}
          </View>
          <Text style={styles.policyText}>
            I agree to ORBII's{' '}
            <Text
              style={styles.policyLink}
              onPress={() => setPolicyOpen(true)}
            >
              Privacy Policy and Terms
            </Text>
            .
          </Text>
        </Pressable>

        <Button
          label="Send OTP"
          onPress={handleSubmit}
          loading={isSending}
          disabled={!canSubmit}
          style={styles.submit}
        />
      </View>

      <PrivacyPolicyModal
        visible={policyOpen}
        onAccept={handleAccept}
        onDecline={handleDecline}
      />
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
  policyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  policyText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  policyLink: {
    fontFamily: typography.bodyMedium.fontFamily,
    color: colors.primary,
  },
  submit: {
    marginTop: spacing.sm,
  },
});
