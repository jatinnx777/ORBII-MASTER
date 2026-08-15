import React, { useEffect, useRef, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrivacyPolicyModal } from '@/components/common';
import {
  colors,
  fontFamilies,
  radius,
  spacing,
  touchTarget,
  typography,
} from '@/theme';
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

// "Welcome back" entry for returning users. Reached via the Welcome
// screen's "Already have an account? Log in" link. Kept visually close
// to Welcome, same gradient, same logo motif, so the transition feels
// like one continuous flow.
export function LoginScreen({ navigation }: AuthScreenProps<'Login'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';

  const [policyOpen, setPolicyOpen] = useState(false);
  const policyOk = policyAcceptedAt !== null;

  const enter = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 480,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.03,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, breathe]);

  // The actual Google sign-in. Separated so the policy modal can call it
  // directly on accept, the user no longer has to tap "Sign in" a second
  // time after agreeing to the terms.
  const doGoogleSignIn = async () => {
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
        appAlert("Couldn't sign in", message);
      }
    }
  };

  const handleSignIn = async () => {
    // Not agreed yet → open the terms. Accepting there continues straight
    // into sign-in (see the modal's onAccept), so this is a single flow.
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    await doGoogleSignIn();
  };

  // Tapping the inline checkbox toggles agreement directly (no modal needed),
  // so a user who's happy to agree can do it in one tap then sign in.
  const togglePolicy = () => {
    if (policyOk) return; // already agreed, leave it on
    dispatch(policyAccepted());
  };

  const translateY = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [16, 0],
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={[colors.brandSoft, '#FFFFFF']}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
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
          <Animated.View style={[styles.logoCard, { transform: [{ scale: breathe }] }]}>
            <Image
              source={require('../../../assets/icon-small.png')}
              style={styles.logoImg}
              resizeMode="contain"
            />
          </Animated.View>

          <Text style={styles.brand}>ORBII</Text>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in to keep your circle, your alerts, and your safety history
            in sync across every device.
          </Text>

          <Pressable
            onPress={handleSignIn}
            disabled={isSigningIn}
            style={({ pressed }) => [
              styles.primaryBtn,
              pressed && styles.primaryBtnPressed,
              isSigningIn && styles.primaryBtnDisabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Sign in with Google"
          >
            <View style={styles.googleMark}>
              <Text style={styles.googleMarkText}>G</Text>
            </View>
            <Text style={styles.primaryBtnLabel}>
              {isSigningIn ? 'Signing in…' : 'Sign in with Google'}
            </Text>
          </Pressable>

          <Pressable
            onPress={togglePolicy}
            style={styles.policyRow}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: policyOk }}
          >
            <View style={[styles.checkbox, policyOk && styles.checkboxChecked]}>
              {policyOk ? (
                <Ionicons name="checkmark" size={12} color={colors.textInverse} />
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

          <View style={styles.reassureRow}>
            <Ionicons name="lock-closed" size={12} color={colors.brandDeep} />
            <Text style={styles.reassureText}>
              Your emergency data stays protected and encrypted.
            </Text>
          </View>

          {DEV_AUTH.enabled ? (
            <Text style={styles.devHint}>
              Sign-in is off in this build. Your profile lives only on this
              device.
            </Text>
          ) : null}
        </Animated.View>
      </SafeAreaView>

      <PrivacyPolicyModal
        visible={policyOpen}
        onAccept={() => {
          dispatch(policyAccepted());
          setPolicyOpen(false);
          // Continue straight into sign-in, no second tap needed.
          void doGoogleSignIn();
        }}
        onDecline={() => setPolicyOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: {
    flex: 1,
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    flexDirection: 'row',
    paddingTop: spacing.sm,
  },
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
  logoCard: {
    width: 110,
    height: 110,
    borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 6,
    marginBottom: spacing.lg,
  },
  logoImg: {
    width: 84,
    height: 84,
  },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.brandDeep,
    letterSpacing: 6,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginTop: spacing.xs,
    letterSpacing: -0.4,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.brandDeep,
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.30,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryBtnPressed: { opacity: 0.92, transform: [{ scale: 0.98 }] },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  googleMark: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleMarkText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 14,
    color: '#4285F4',
  },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: spacing.lg,
    alignSelf: 'stretch',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.brandMid,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  policyText: {
    flex: 1,
    fontFamily: fontFamilies.interRegular,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  policyLink: {
    fontFamily: fontFamilies.interMedium,
    color: colors.brandDeep,
  },
  reassureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  reassureText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11,
    color: colors.textSecondary,
    letterSpacing: 0.2,
  },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
