import React, { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Mascot, PrivacyPolicyModal } from '@/components/common';
import { colors, radius, shadows, spacing, typography, fontFamilies } from '@/theme';
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

// Welcome Back, matched to the reference design: ORBII lockup, Orbi on a
// cloud with a time-aware greeting bubble, three sign-in pills, Sign Up
// link and the safety-data footnote. Google is the real auth; Apple/Email
// are honest "coming soon" until configured.
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';
  const policyOk = policyAcceptedAt !== null;

  const [policyOpen, setPolicyOpen] = useState(false);

  // Time-aware bubble: Orbi greets the moment, not a template.
  const hour = new Date().getHours();
  const bubbleText =
    hour < 5
      ? 'Up late? I’m right here.'
      : hour < 12
        ? 'Good morning.\nLovely to see you.'
        : hour < 17
          ? 'Good afternoon.\nGood to see you.'
          : hour < 21
            ? 'Good evening.\nGood to see you.'
            : 'Heading out tonight?\nI’ve got you.';

  // Soft float on the cloud + pop-in.
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2400, useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);
  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

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
      if (!/cancel/i.test(message)) appAlert("Couldn't sign in", message);
    }
  };

  const comingSoon = (method: string) =>
    appAlert(`${method} sign-in coming soon`, 'For now, please continue with Google.');

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* ORBII lockup */}
          <View style={styles.brandRow}>
            <Ionicons name="shield-checkmark" size={16} color={colors.peachDeep} />
            <Text style={styles.brand}>ORBII</Text>
          </View>

          {/* Orbi on a cloud + time-aware bubble */}
          <View style={styles.hero}>
            <View style={styles.speechBubble}>
              <Text style={styles.speechText}>{bubbleText}</Text>
            </View>
            <Animated.View style={{ transform: [{ translateY: floatY }], alignItems: 'center' }}>
              <Mascot pose="wave" size={164} />
              <View style={styles.cloud} />
            </Animated.View>
          </View>

          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.sub}>Your guardian is ready whenever you need it.</Text>

          <View style={styles.ctaStack}>
            <AuthButton
              icon={<Text style={[styles.gMark, { color: '#4285F4' }]}>G</Text>}
              label={isSigningIn ? 'Signing you in…' : 'Continue with Google'}
              onPress={handleGoogle}
              disabled={isSigningIn}
            />
            <AuthButton
              icon={<Ionicons name="logo-apple" size={20} color={colors.textPrimary} />}
              label="Continue with Apple"
              onPress={() => comingSoon('Apple')}
            />
            <AuthButton
              icon={<Ionicons name="mail-outline" size={19} color={colors.textPrimary} />}
              label="Continue with Email"
              onPress={() => comingSoon('Email')}
            />
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <Pressable style={styles.signupRow} onPress={handleGoogle} hitSlop={8} disabled={isSigningIn}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Text style={styles.signupLink}>Sign Up</Text>
          </Pressable>

          <Pressable style={styles.privacyRow} onPress={() => setPolicyOpen(true)} hitSlop={8}>
            <Ionicons name="shield-checkmark-outline" size={13} color={colors.sageDeep} />
            <Text style={styles.privacyText}>Your safety data belongs to you.</Text>
          </Pressable>

          {DEV_AUTH.enabled ? <Text style={styles.devHint}>Sign-in is off in this build.</Text> : null}
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
      style={({ pressed }) => [styles.authBtn, pressed && styles.authBtnPressed, disabled && { opacity: 0.6 }]}
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
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.sm,
  },
  brand: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 13,
    letterSpacing: 3,
    color: colors.textPrimary,
  },
  hero: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  speechBubble: {
    alignSelf: 'flex-end',
    marginRight: spacing.lg,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderBottomRightRadius: 4,
    marginBottom: -6,
    zIndex: 2,
    ...shadows.icon,
  },
  speechText: {
    ...typography.caption,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textSecondary,
  },
  cloud: {
    width: 158,
    height: 44,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    marginTop: -26,
    zIndex: -1,
    shadowColor: '#C9A24B',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  title: {
    ...typography.displaySmall,
    fontSize: 30,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    maxWidth: 300,
  },
  ctaStack: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  authBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  authBtnPressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
  authIcon: { width: 24, alignItems: 'center', marginRight: spacing.md },
  authLabel: {
    ...typography.button,
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: colors.textPrimary,
  },
  gMark: { fontFamily: 'Poppins_700Bold', fontSize: 18 },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    alignSelf: 'stretch',
    marginTop: spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.label, color: colors.textMuted },
  signupRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  signupText: { ...typography.body, fontSize: 14, color: colors.textSecondary },
  signupLink: {
    ...typography.body,
    fontSize: 14,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.peachDeep,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  privacyText: { ...typography.caption, fontSize: 12, color: colors.textSecondary },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
});
