import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, ScreenContainer } from '@/components/common';
import { colors, radius, spacing, touchTarget, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  otpSendFailed,
  otpSendStarted,
  otpSendSucceeded,
  otpVerifyFailed,
  otpVerifyStarted,
  otpVerifySucceeded,
} from '@/redux/slices/userSlice';
import { sendOtp, verifyOtp } from '@/services/auth';
import { toE164India } from '@/utils/validation';
import type { AuthScreenProps } from '@/navigation/types';

const OTP_LENGTH = 6;
const RESEND_SECONDS = 30;

export function OTPScreen({ route, navigation }: AuthScreenProps<'OTP'>) {
  const { phone } = route.params;
  const dispatch = useAppDispatch();
  const { verificationId, status } = useAppSelector((s) => s.user);

  const [digits, setDigits] = useState<string[]>(
    () => new Array(OTP_LENGTH).fill(''),
  );
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const inputsRef = useRef<Array<TextInput | null>>([]);

  const isVerifying = status === 'verifying_otp';
  const isResending = status === 'sending_otp';
  const code = digits.join('');
  const isComplete = code.length === OTP_LENGTH;

  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setInterval(
      () => setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0)),
      1000,
    );
    return () => clearInterval(id);
  }, [secondsLeft]);

  const handleChange = (index: number, value: string) => {
    const onlyDigits = value.replace(/\D/g, '');
    if (!onlyDigits) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }

    // Support paste of full code into the first box.
    if (onlyDigits.length > 1) {
      const pasted = onlyDigits.slice(0, OTP_LENGTH - index).split('');
      const next = [...digits];
      pasted.forEach((d, i) => {
        next[index + i] = d;
      });
      setDigits(next);
      const nextFocus = Math.min(index + pasted.length, OTP_LENGTH - 1);
      inputsRef.current[nextFocus]?.focus();
      if (error) setError(null);
      return;
    }

    const next = [...digits];
    next[index] = onlyDigits;
    setDigits(next);
    if (error) setError(null);

    if (index < OTP_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    index: number,
    key: string,
  ) => {
    if (key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = '';
      setDigits(next);
    }
  };

  const handleVerify = async () => {
    if (!isComplete || !verificationId) {
      setError('Enter the 6-digit code we sent you.');
      return;
    }
    dispatch(otpVerifyStarted());
    try {
      const result = await verifyOtp(phone, code, verificationId);
      dispatch(
        otpVerifySucceeded({
          profile: result.profile,
          needsProfile: result.needsProfile,
        }),
      );
      if (result.needsProfile) {
        navigation.reset({
          index: 0,
          routes: [{ name: 'ProfileSetup' }],
        });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Verification failed.';
      dispatch(otpVerifyFailed({ error: message }));
      setError(message);
      setDigits(new Array(OTP_LENGTH).fill(''));
      inputsRef.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (secondsLeft > 0 || isResending) return;
    dispatch(otpSendStarted({ phone }));
    try {
      const { verificationId: newId } = await sendOtp(phone);
      dispatch(otpSendSucceeded({ verificationId: newId }));
      setDigits(new Array(OTP_LENGTH).fill(''));
      setError(null);
      setSecondsLeft(RESEND_SECONDS);
      inputsRef.current[0]?.focus();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not resend OTP.';
      dispatch(otpSendFailed({ error: message }));
      Alert.alert('Could not resend', message);
    }
  };

  return (
    <ScreenContainer scroll>
      <View style={styles.body}>
        <Text style={styles.title}>Verify your number</Text>
        <Text style={styles.subtitle}>
          Enter the 6-digit code sent to{' '}
          <Text style={styles.phoneText}>{toE164India(phone)}</Text>.
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.changeLink}
        >
          <Text style={styles.changeLinkText}>Change number</Text>
        </Pressable>

        <View style={styles.otpRow}>
          {digits.map((digit, index) => (
            <TextInput
              key={index}
              ref={(r) => {
                inputsRef.current[index] = r;
              }}
              value={digit}
              onChangeText={(value) => handleChange(index, value)}
              onKeyPress={({ nativeEvent }) =>
                handleKeyPress(index, nativeEvent.key)
              }
              keyboardType="number-pad"
              maxLength={index === 0 ? OTP_LENGTH : 1}
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              style={[
                styles.otpBox,
                digit ? styles.otpBoxFilled : null,
                error ? styles.otpBoxError : null,
              ]}
              selectionColor={colors.primary}
            />
          ))}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <Button
          label="Verify"
          onPress={handleVerify}
          loading={isVerifying}
          disabled={!isComplete || isVerifying}
          style={styles.submit}
        />

        <View style={styles.resendRow}>
          <Text style={styles.resendLabel}>Didn't receive the code?</Text>
          <Pressable
            onPress={handleResend}
            disabled={secondsLeft > 0 || isResending}
            hitSlop={12}
          >
            <Text
              style={[
                styles.resendAction,
                (secondsLeft > 0 || isResending) && styles.resendDisabled,
              ]}
            >
              {secondsLeft > 0
                ? `Resend in ${secondsLeft}s`
                : isResending
                  ? 'Sending…'
                  : 'Resend OTP'}
            </Text>
          </Pressable>
        </View>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    marginTop: spacing.xl,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  phoneText: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  changeLink: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  changeLinkText: {
    ...typography.label,
    color: colors.primary,
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  otpBox: {
    width: 48,
    height: touchTarget.comfortable,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    textAlign: 'center',
    ...typography.h3,
    color: colors.textPrimary,
  },
  otpBoxFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.background,
  },
  otpBoxError: {
    borderColor: colors.error,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginBottom: spacing.md,
  },
  submit: {
    marginTop: spacing.sm,
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: spacing.xs,
  },
  resendLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  resendAction: {
    ...typography.bodyMedium,
    color: colors.primary,
  },
  resendDisabled: {
    color: colors.textMuted,
  },
});
