import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
import { useAppDispatch } from '@/redux/store';
import {
  signInFailed,
  signInStarted,
  signInSucceeded,
} from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import {
  sendEmailOtp,
  sendOtpToE164,
  verifyEmailOtp,
  verifyPhoneOtp,
} from '@/services/auth';
import type { AuthScreenProps } from '@/navigation/types';

// OTP entry. Renders a single hidden TextInput styled to look like a row of
// boxes, which supports paste-fill from the SMS/e-mail suggestion bar. Email
// codes are 8 digits; SMS codes are 6, so the box count follows the channel.
const RESEND_COOLDOWN_S = 30;

export function PhoneVerifyScreen({
  route,
  navigation,
}: AuthScreenProps<'PhoneVerify'>) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  // The same screen verifies an SMS code or an email code.
  const phone = route.params.phone;
  const email = route.params.email;
  const target = phone ?? email ?? '';
  const isEmail = !phone && !!email;
  // SMS codes are exactly 6. Email codes depend on the Supabase OTP length
  // setting (6 by default, up to 8), so email accepts 6 to 8 and enables Verify
  // as soon as 6 digits are in. This avoids blocking sign-in if the real code is
  // shorter than the boxes shown.
  const otpLength = isEmail ? 8 : 6;
  const minLen = isEmail ? 6 : 6;
  const boxW = otpLength > 6 ? 36 : 44;
  const boxH = otpLength > 6 ? 48 : 56;
  const boxGap = otpLength > 6 ? 6 : 8;

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_S);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const ready = (isEmail ? code.length >= minLen : code.length === otpLength) && !verifying;

  const onVerify = async () => {
    if (!ready) return;
    setVerifying(true);
    setError(null);
    dispatch(signInStarted());
    try {
      const { profile, needsProfile, history } = isEmail
        ? await verifyEmailOtp(email!, code)
        : await verifyPhoneOtp(phone!, code);
      dispatch(signInSucceeded({ profile, needsProfile }));
      dispatch(historyHydrated(history));
      if (needsProfile) {
        navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : t('phone.otpFailed');
      setError(message);
      dispatch(signInFailed({ error: message }));
    } finally {
      setVerifying(false);
    }
  };

  const onResend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setError(null);
    try {
      if (isEmail) await sendEmailOtp(email!);
      else await sendOtpToE164(phone!);
      setResendIn(RESEND_COOLDOWN_S);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('phone.otpFailed'));
    } finally {
      setResending(false);
    }
  };

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.headerRow}>
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Ionicons name="arrow-back" size={20} color={colors.textPrimary} />
            </Pressable>
          </View>

          <Animated.View
            style={[
              styles.body,
              { opacity: enter, transform: [{ translateY }] },
            ]}
          >
            <Text style={styles.title}>OTP Verification</Text>
            <Text style={styles.subtitle}>
              We have sent a verification code to{'\n'}
              <Text style={styles.target}>{target}</Text>
            </Text>

            <TextInput
              value={code}
              onChangeText={(v) => {
                setCode(v.replace(/\D/g, '').slice(0, otpLength));
                if (error) setError(null);
              }}
              keyboardType="number-pad"
              maxLength={otpLength}
              autoComplete="sms-otp"
              autoFocus
              textContentType="oneTimeCode"
              style={styles.otpField}
            />

            <View style={[styles.boxesRow, { gap: boxGap }]}>
              {Array.from({ length: otpLength }).map((_, i) => {
                const filled = i < code.length;
                return (
                  <View
                    key={i}
                    style={[
                      styles.box,
                      { width: boxW, height: boxH },
                      filled && styles.boxFilled,
                      i === code.length && styles.boxActive,
                    ]}
                  >
                    <Text style={styles.boxText}>{code[i] ?? ''}</Text>
                  </View>
                );
              })}
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <Pressable
              onPress={onVerify}
              disabled={!ready}
              style={({ pressed }) => [
                styles.primaryBtn,
                !ready && styles.primaryBtnDisabled,
                pressed && ready && styles.pressed,
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnLabel}>
                {verifying ? t('phone.verifying') : t('phone.verify')}
              </Text>
            </Pressable>

            <Pressable
              onPress={onResend}
              disabled={resendIn > 0 || resending}
              style={styles.resendBtn}
            >
              <Text
                style={[
                  styles.resendText,
                  resendIn === 0 && !resending && styles.resendActive,
                ]}
              >
                {resendIn > 0
                  ? t('phone.resendIn', { seconds: resendIn })
                  : t('phone.resend')}
              </Text>
            </Pressable>
          </Animated.View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  flex: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: spacing.lg },
  headerRow: { paddingTop: spacing.sm, flexDirection: 'row' },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    paddingTop: spacing.xl,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.5,
    color: '#141527',
  },
  subtitle: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 13.5,
    lineHeight: 21,
    color: '#6B6B7B',
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 26,
  },
  target: {
    fontFamily: fontFamilies.poppinsBold,
    color: colors.textPrimary,
    fontSize: 15,
  },
  otpField: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
  boxesRow: {
    flexDirection: 'row',
    marginTop: spacing.xl,
  },
  box: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6E4EE',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxFilled: {
    borderColor: '#141527',
  },
  boxActive: {
    borderColor: '#141527',
    borderWidth: 1.8,
  },
  boxText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: '#141527',
  },
  errorText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.error,
    marginTop: spacing.md,
  },
  primaryBtn: {
    height: 56,
    borderRadius: 28,
    backgroundColor: '#141527',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    marginTop: 26,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15.5,
    color: '#FFFFFF',
  },
  resendBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  resendText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    color: colors.textMuted,
  },
  resendActive: {
    color: colors.brandDeep,
    fontFamily: fontFamilies.poppinsSemiBold,
  },
  pressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
});
