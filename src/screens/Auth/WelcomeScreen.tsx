import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, PrivacyPolicyModal } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { signInFailed, signInStarted, signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { policyAccepted } from '@/redux/slices/appSlice';
import { signInWithGoogle, sendEmailOtp, DEV_AUTH } from '@/services/auth';
import type { AuthScreenProps } from '@/navigation/types';

const ICON = require('../../../assets/icon-small.png');

// A safety app deliberately has no "skip login": an SOS with no identity reaches
// nobody. This is the first screen a new user sees, so it leads with the promise
// (voice is enough), then makes signing in effortless.

const WAVE = [10, 18, 30, 46, 26, 38, 20, 52, 34, 22, 40, 16];

export function WelcomeScreen({ navigation }: AuthScreenProps<'Welcome'>) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.user.status);
  const policyAcceptedAt = useAppSelector((s) => s.app.policyAcceptedAt);
  const isSigningIn = status === 'signing_in';
  const policyOk = policyAcceptedAt !== null;

  const [policyOpen, setPolicyOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());

  // Gentle live waveform under the headline: on-brand for a voice-first app.
  const wave = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(wave, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    ).start();
  }, [wave]);

  const gate = () => {
    if (!policyOk) {
      setPolicyOpen(true);
      return false;
    }
    return true;
  };

  const handleGoogle = async () => {
    if (!gate()) return;
    dispatch(signInStarted());
    try {
      const { profile, needsProfile, history } = await signInWithGoogle();
      dispatch(signInSucceeded({ profile, needsProfile }));
      dispatch(historyHydrated(history));
      if (needsProfile) navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) appAlert("Couldn't sign in", message);
    }
  };

  const handleEmail = async () => {
    if (!emailOk || sending) return;
    if (!gate()) return;
    setSending(true);
    try {
      const addr = await sendEmailOtp(email);
      navigation.navigate('PhoneVerify', { email: addr });
    } catch (err) {
      appAlert(
        "Couldn't send the code",
        err instanceof Error ? err.message : 'Please try again in a moment.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.root}>
      {/* Soft brand glow at the top. */}
      <LinearGradient
        colors={[colors.brandSoft, colors.cream]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 0.7 }}
        style={styles.glow}
      />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Hero */}
            <View style={styles.hero}>
              <View style={styles.brandTile}>
                <Image source={ICON} style={styles.brandImg} resizeMode="contain" />
              </View>

              <Text style={styles.headline}>Help is one{'\n'}word away</Text>

              <View style={styles.wave} aria-hidden>
                {WAVE.map((h, i) => {
                  const scale = wave.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, i % 2 === 0 ? 1.6 : 0.6],
                  });
                  return (
                    <Animated.View
                      key={i}
                      style={[styles.waveBar, { height: h, transform: [{ scaleY: scale }] }]}
                    />
                  );
                })}
              </View>

              <Text style={styles.sub}>
                Say the word and ORBII sends for help, hands-free. Sign in to keep
                your circle and alerts in sync.
              </Text>
            </View>

            {/* Auth card */}
            <View style={styles.card}>
              <Pressable
                onPress={handleGoogle}
                disabled={isSigningIn}
                style={({ pressed }) => [styles.googleBtn, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.gMark}>G</Text>
                <Text style={styles.googleText}>
                  {isSigningIn ? 'Signing you in…' : 'Continue with Google'}
                </Text>
              </Pressable>

              <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.or}>or</Text>
                <View style={styles.line} />
              </View>

              <View style={styles.emailField}>
                <Ionicons name="mail-outline" size={19} color={colors.textMuted} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@email.com"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.input}
                />
              </View>

              <Pressable
                onPress={handleEmail}
                disabled={!emailOk || sending}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  (!emailOk || sending) && styles.primaryOff,
                  pressed && emailOk && styles.pressed,
                ]}
                accessibilityRole="button"
              >
                <Text style={styles.primaryText}>
                  {sending ? 'Sending code…' : 'Email me a code'}
                </Text>
              </Pressable>

              <View style={styles.reassure}>
                <Ionicons name="lock-closed" size={12} color={colors.brandDeep} />
                <Text style={styles.reassureText}>Private by design. Your audio never leaves your phone.</Text>
              </View>

              {DEV_AUTH.enabled ? (
                <Text style={styles.devHint}>Test mode: OTP is bypassed.</Text>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.terms}>
          <Text style={styles.termsText}>By continuing, you agree to our </Text>
          <Pressable onPress={() => setPolicyOpen(true)} hitSlop={6}>
            <Text style={styles.termsLink}>Terms & Privacy</Text>
          </Pressable>
        </View>
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
  root: { flex: 1, backgroundColor: colors.cream },
  glow: { position: 'absolute', top: 0, left: 0, right: 0, height: 420 },
  flex: { flex: 1 },
  safe: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl },

  hero: { alignItems: 'center', marginBottom: spacing.xl },
  brandTile: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  brandImg: { width: 52, height: 52 },
  headline: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    lineHeight: 40,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 56, marginTop: spacing.lg },
  waveBar: { width: 5, borderRadius: 99, backgroundColor: colors.brand },
  sub: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
    maxWidth: 320,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 28,
    padding: spacing.lg,
    ...shadows.card,
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  gMark: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: '#4285F4' },
  googleText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },

  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.md },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted },

  emailField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 58,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.cream,
  },
  input: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 16, color: colors.textPrimary },

  primaryBtn: {
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    ...shadows.card,
  },
  primaryOff: { backgroundColor: colors.brandSoft, shadowOpacity: 0 },
  primaryText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textInverse },
  pressed: { opacity: 0.92, transform: [{ scale: 0.99 }] },

  reassure: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: spacing.md },
  reassureText: { fontFamily: fontFamilies.interMedium, fontSize: 11.5, color: colors.textSecondary },

  devHint: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },

  terms: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', paddingVertical: spacing.md },
  termsText: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted },
  termsLink: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12, color: colors.brandDeep, textDecorationLine: 'underline' },
});
