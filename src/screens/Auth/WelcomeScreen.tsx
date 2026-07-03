import React, { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import { Animated, Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
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

const { width } = Dimensions.get('window');

// Fable "Let's look out for you" — the commitment moment. Orbi celebrates you
// arriving; a sign-in card rises from the bottom; one warm trust cue sits under
// the Google button. Google is the real auth; Apple/Email are honest
// "coming soon" until configured.
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';
  const policyOk = policyAcceptedAt !== null;

  const [policyOpen, setPolicyOpen] = useState(false);

  // Card rises + Orbi pops in on mount.
  const cardY = useRef(new Animated.Value(60)).current;
  const pop = useRef(new Animated.Value(0.85)).current;
  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    Animated.parallel([
      Animated.spring(cardY, { toValue: 0, friction: 9, tension: 60, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
    ]).start();
  }, [cardY, pop]);

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
      <View pointerEvents="none" style={styles.glow} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.top}>
          <Animated.View style={{ transform: [{ scale: pop }] }}>
            <Mascot pose="celebrate" size={172} />
          </Animated.View>
        </View>

        <Animated.View style={[styles.card, { transform: [{ translateY: cardY }] }]}>
          <Text style={styles.title}>Let’s look out for you.</Text>
          <Text style={styles.sub}>
            Sign in so your circle can find you when it matters. Takes 10 seconds.
          </Text>

          <Pressable
            onPress={handleGoogle}
            disabled={isSigningIn}
            style={({ pressed }) => [styles.googleBtn, pressed && styles.pressed, isSigningIn && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            <Text style={[styles.gMark, { color: '#4285F4' }]}>G</Text>
            <Text style={styles.googleLabel}>
              {isSigningIn ? 'Signing you in…' : 'Continue with Google'}
            </Text>
          </Pressable>

          <View style={styles.secondaryRow}>
            <SmallBtn icon="logo-apple" label="Apple" onPress={() => comingSoon('Apple')} />
            <SmallBtn icon="mail-outline" label="Email" onPress={() => comingSoon('Email')} />
          </View>

          <View style={styles.trustRow}>
            <Ionicons name="lock-closed" size={13} color={colors.sageDeep} />
            <Text style={styles.trustText}>
              Your location stays private until <Text style={styles.trustStrong}>you</Text> trigger an
              SOS. We never sell your data.
            </Text>
          </View>

          <Pressable onPress={() => setPolicyOpen(true)} hitSlop={8} style={styles.termsRow}>
            <Text style={styles.terms}>Privacy Policy & Terms</Text>
          </Pressable>

          {DEV_AUTH.enabled ? <Text style={styles.devHint}>Sign-in is off in this build.</Text> : null}
        </Animated.View>
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

function SmallBtn({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.smallBtn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={18} color={colors.textPrimary} />
      <Text style={styles.smallLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  glow: {
    position: 'absolute',
    top: -width * 0.2,
    alignSelf: 'center',
    width: width * 1.1,
    height: width * 1.1,
    borderRadius: (width * 1.1) / 2,
    backgroundColor: '#F3C7A6',
    opacity: 0.4,
  },
  safe: { flex: 1 },
  top: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: spacing.lg },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
    ...shadows.card,
  },
  title: {
    ...typography.displaySmall,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.sm,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.95 },
  gMark: { fontFamily: 'Poppins_700Bold', fontSize: 18 },
  googleLabel: {
    ...typography.button,
    fontFamily: 'Poppins_600SemiBold',
    color: colors.textPrimary,
  },
  secondaryRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  smallBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.cream,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  trustRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  trustText: {
    flex: 1,
    ...typography.caption,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textSecondary,
  },
  trustStrong: { fontFamily: fontFamilies.poppinsSemiBold, color: colors.textPrimary },
  termsRow: { alignSelf: 'center', marginTop: spacing.md },
  terms: {
    ...typography.caption,
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: 'underline',
  },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
