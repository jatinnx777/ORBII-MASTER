import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
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

// Minimal Welcome screen. Calm, unhurried, almost ceremonial. Dropped
// the pulsing concentric rings and the multi-card layout because both
// read as "AI-generated welcome template". Everything that survived has
// a purpose:
//
//   • A single floating gradient orb in the upper-right gives the
//     screen warmth without competing for attention.
//   • The logo breathes (1 → 1.025) — slow enough to read as alive,
//     not flashy.
//   • Typography does the heavy lifting: large heading, generous
//     line-height, lots of whitespace.
//   • Three CTAs in a clean stack. Privacy reassurance is one short
//     line at the foot.
export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
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
      duration: 700,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1.025,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enter, breathe]);

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
      const message =
        err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) {
        Alert.alert("Couldn't sign in", message);
      }
    }
  };

  const handleEmail = () => {
    Alert.alert(
      'Email sign-in coming soon',
      "We're rolling this out shortly. For now, please continue with Google.",
    );
  };

  const translate = enter.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={['#FFFFFF', colors.brandSoft, '#FFFFFF']}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/* Single floating gradient orb — adds warmth without noise. */}
      <View pointerEvents="none" style={styles.orbWrap}>
        <LinearGradient
          colors={[colors.brandMid, 'rgba(149,213,178,0)']}
          style={styles.orb}
        />
      </View>

      <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
        <Animated.View
          style={[
            styles.content,
            { opacity: enter, transform: [{ translateY: translate }] },
          ]}
        >
          <View style={styles.spacer} />

          <Animated.View
            style={[styles.logoCard, { transform: [{ scale: breathe }] }]}
          >
            <Image
              source={require('../../../assets/icon.png')}
              style={styles.logoImg}
              resizeMode="contain"
            />
          </Animated.View>

          <Text style={styles.brand}>ORBII</Text>

          <Text style={styles.heading}>Protection that stays{'\n'}with you.</Text>
          <Text style={styles.sub}>
            Smart safety for everyday life, travel, and emergencies.
          </Text>

          <View style={styles.spacer} />

          <View style={styles.actionsCol}>
            <Pressable
              onPress={handleGoogle}
              disabled={isSigningIn}
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.primaryBtnPressed,
                isSigningIn && styles.primaryBtnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <View style={styles.googleMark}>
                <Text style={styles.googleMarkText}>G</Text>
              </View>
              <Text style={styles.primaryBtnLabel}>
                {isSigningIn ? 'Signing in…' : 'Continue with Google'}
              </Text>
            </Pressable>

            <Pressable
              onPress={handleEmail}
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.secondaryBtnPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Continue with Email"
            >
              <Text style={styles.secondaryBtnLabel}>Continue with Email</Text>
              <Text style={styles.soonPill}>SOON</Text>
            </Pressable>

            <Pressable
              onPress={() => navigation.navigate('Login')}
              style={({ pressed }) => [
                styles.linkBtn,
                pressed && { opacity: 0.6 },
              ]}
              accessibilityRole="button"
            >
              <Text style={styles.linkText}>Already signed in? Open your account.</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => setPolicyOpen(true)}
            style={styles.policyRow}
            hitSlop={8}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: policyOk }}
          >
            <View style={[styles.checkbox, policyOk && styles.checkboxChecked]}>
              {policyOk ? (
                <Ionicons name="checkmark" size={11} color={colors.textInverse} />
              ) : null}
            </View>
            <Text style={styles.policyText}>
              I agree to ORBII's{' '}
              <Text style={styles.policyLink}>Privacy Policy and Terms</Text>.
            </Text>
          </Pressable>

          <Text style={styles.reassureText}>
            Encrypted by design. Your data never leaves your circle.
          </Text>

          {DEV_AUTH.enabled ? (
            <Text style={styles.devHint}>
              Sign-in is off in this build.
            </Text>
          ) : null}
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

const styles = StyleSheet.create({
  root: { flex: 1 },
  orbWrap: {
    position: 'absolute',
    top: -90,
    right: -110,
    width: 320,
    height: 320,
  },
  orb: {
    flex: 1,
    borderRadius: 160,
    opacity: 0.55,
  },
  safe: {
    flex: 1,
    paddingHorizontal: spacing.xl,
  },
  content: {
    flex: 1,
    alignItems: 'center',
  },
  spacer: { flex: 1 },
  logoCard: {
    width: 96,
    height: 96,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 22,
    elevation: 6,
  },
  logoImg: { width: '100%', height: '100%' },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: colors.brandDeep,
    letterSpacing: 6,
    marginTop: spacing.md,
  },
  heading: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: spacing.lg,
    letterSpacing: -0.6,
    lineHeight: 38,
  },
  sub: {
    ...typography.body,
    fontSize: 15,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
    paddingHorizontal: spacing.sm,
  },
  actionsCol: {
    alignSelf: 'stretch',
    gap: 10,
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
    shadowColor: colors.brandDeep,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 14,
    elevation: 6,
  },
  primaryBtnPressed: { opacity: 0.94, transform: [{ scale: 0.98 }] },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 15,
    color: colors.textInverse,
    letterSpacing: 0.3,
  },
  googleMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleMarkText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13,
    color: '#4285F4',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: touchTarget.comfortable,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  secondaryBtnLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  soonPill: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 9,
    color: colors.brandDeep,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.circle,
    letterSpacing: 0.6,
  },
  linkBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
  },
  linkText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textSecondary,
  },
  policyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 4,
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: colors.brandMid,
    backgroundColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
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
  reassureText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  devHint: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
