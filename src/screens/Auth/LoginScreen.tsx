import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  PrivacyPolicyModal,
  ScreenContainer,
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, touchTarget, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  signInFailed,
  signInStarted,
  signInSucceeded,
} from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { policyAccepted } from '@/redux/slices/appSlice';
import { signInWithGoogle, DEV_AUTH } from '@/services/auth';
import type { AuthScreenProps } from '@/navigation/types';

export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';

  const [policyOpen, setPolicyOpen] = useState(false);
  const policyOk = policyAcceptedAt !== null;

  const handleSignIn = async () => {
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    dispatch(signInStarted());
    try {
      const { profile, needsProfile, history } = await signInWithGoogle();
      dispatch(signInSucceeded({ profile, needsProfile }));
      dispatch(historyHydrated(history));
      if (needsProfile) {
        navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] });
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) {
        Alert.alert("Couldn't sign in", message);
      }
    }
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
        <Text style={styles.title}>Welcome to ORBII</Text>
        <Text style={styles.subtitle}>
          Tap below to get started. You can set up your profile in the next
          step so nearby helpers can recognise you in an emergency.
        </Text>

        <Pressable
          onPress={handleSignIn}
          disabled={isSigningIn}
          style={({ pressed }) => [
            styles.continueBtn,
            pressed && styles.continueBtnPressed,
            isSigningIn && styles.continueBtnDisabled,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Continue"
        >
          {isSigningIn ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.continueLabel}>Continue</Text>
          )}
        </Pressable>

        <Pressable
          onPress={() => setPolicyOpen(true)}
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

        {DEV_AUTH.enabled ? (
          <Text style={styles.devHint}>
            Sign-in is off in this build. Your profile lives only on this
            device.
          </Text>
        ) : null}
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
    color: colors.brandDeep,
    letterSpacing: 4,
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
    marginBottom: spacing.xxl,
  },
  continueBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  continueBtnPressed: {
    opacity: 0.88,
  },
  continueBtnDisabled: {
    opacity: 0.6,
  },
  continueLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textInverse,
    letterSpacing: 0.4,
  },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xl,
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
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  policyText: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    flex: 1,
  },
  // green link colour for the privacy policy / terms anchors
  policyLink: {
    fontFamily: typography.bodyMedium.fontFamily,
    color: colors.brandDeep,
  },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
