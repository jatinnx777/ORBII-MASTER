import React, { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Mascot, PrivacyPolicyModal } from '@/components/common';
import { colors, radius, shadows, spacing, typography } from '@/theme';
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

// "Welcome Back" — first impression, matching the reference: wave mascot on
// a soft cloud, three stacked sign-in methods, a Sign Up link. Real auth is
// Google (working) + Phone (the Sign Up path). Apple/Email are honest
// "coming soon" until configured.
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';
  const policyOk = policyAcceptedAt !== null;

  const [policyOpen, setPolicyOpen] = useState(false);

  const handleGoogle = async () => {
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
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) Alert.alert("Couldn't sign in", message);
    }
  };

  const handleSignUp = () => {
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    navigation.navigate('PhoneSignIn');
  };

  const comingSoon = (method: string) =>
    Alert.alert(
      `${method} sign-in coming soon`,
      'For now, please continue with Google or sign up with your phone.',
    );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* mascot on a cloud */}
          <View style={styles.hero}>
            <Mascot pose="wave" size={172} />
            <View style={styles.cloud} />
            <View style={styles.speechBubble}>
              <Text style={styles.speechText}>Good to{'\n'}see you again.</Text>
            </View>
          </View>

          <Text style={styles.title}>{t('welcome.welcomeBack', 'Welcome Back')}</Text>
          <Text style={styles.sub}>
            {t('welcome.guardianReady', 'Your guardian is ready whenever you need it.')}
          </Text>

          <View style={styles.ctaStack}>
            <AuthButton
              icon={<Text style={[styles.gMark, { color: '#4285F4' }]}>G</Text>}
              label={isSigningIn ? '…' : 'Continue with Google'}
              onPress={handleGoogle}
              disabled={isSigningIn}
            />
            <AuthButton
              icon={<Ionicons name="logo-apple" size={20} color={colors.textPrimary} />}
              label="Continue with Apple"
              onPress={() => comingSoon('Apple')}
            />
            <AuthButton
              icon={<Ionicons name="mail-outline" size={20} color={colors.textPrimary} />}
              label="Continue with Email"
              onPress={() => comingSoon('Email')}
            />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable style={styles.signupRow} onPress={handleSignUp} hitSlop={8}>
            <Text style={styles.signupText}>Don’t have an account? </Text>
            <Text style={styles.signupLink}>Sign Up</Text>
          </Pressable>

          <Pressable
            style={styles.privacyRow}
            onPress={() => setPolicyOpen(true)}
            hitSlop={8}
          >
            <Ionicons name="shield-checkmark" size={13} color={colors.sage} />
            <Text style={styles.privacyText}>Your safety data belongs to you.</Text>
          </Pressable>

          {DEV_AUTH.enabled ? (
            <Text style={styles.devHint}>Sign-in is off in this build.</Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <PrivacyPolicyModal
        visible={policyOpen}
        onAccept={() => {
          dispatch(policyAccepted());
          setPolicyOpen(false);
        }}
        onDecline={() => setPolicyOpen(false)}
      />
    </View>
  );
}

function AuthButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.authBtn,
        pressed && styles.authBtnPressed,
        disabled && { opacity: 0.6 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.authIcon}>{icon}</View>
      <Text style={styles.authLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    alignItems: 'center',
  },
  hero: {
    width: '100%',
    height: 230,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  cloud: {
    position: 'absolute',
    bottom: 18,
    width: 150,
    height: 46,
    borderRadius: 30,
    backgroundColor: colors.surfaceAlt,
    ...shadows.icon,
    zIndex: -1,
  },
  speechBubble: {
    position: 'absolute',
    top: 24,
    right: 24,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    ...shadows.icon,
  },
  speechText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  title: {
    ...typography.displaySmall,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 300,
  },
  ctaStack: {
    alignSelf: 'stretch',
    gap: spacing.md,
    marginTop: spacing.xl,
  },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  authBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
  authIcon: {
    width: 24,
    alignItems: 'center',
    marginRight: spacing.md,
  },
  authLabel: {
    ...typography.button,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
  },
  gMark: {
    fontFamily: 'Poppins_700Bold',
    fontSize: 18,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
    marginTop: spacing.xl,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.label, color: colors.textMuted },
  signupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  signupText: { ...typography.body, color: colors.textSecondary },
  signupLink: {
    ...typography.body,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.peachDeep,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xl,
  },
  privacyText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
