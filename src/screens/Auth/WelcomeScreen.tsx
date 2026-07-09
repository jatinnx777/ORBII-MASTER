import React, { useState } from 'react';
import {
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

const ORBI = require('../../../assets/onboarding/orbi-hero.png');

// Sign in with Google (OAuth) or an email OTP. Both are free and need no SMS
// gateway. The user's phone is collected once during profile setup — it is the
// number an SOS actually dials, so it's confirmed twice and then locked.
//
// A safety app deliberately has no "skip login": an SOS with no identity
// reaches nobody.

const TILES: (keyof typeof Ionicons.glyphMap)[] = [
  'mic', 'shield-checkmark', 'location', 'people', 'call', 'navigate',
  'heart', 'walk', 'notifications', 'lock-closed', 'hand-left', 'medkit',
];

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
      {/* ── Tile wall ── */}
      <View style={styles.wall} pointerEvents="none">
        {[0, 1, 2].map((row) => (
          <View key={row} style={[styles.wallRow, { marginLeft: row % 2 ? -34 : 0 }]}>
            {TILES.slice(row * 4, row * 4 + 4).map((icon) => (
              <View key={icon} style={styles.tile}>
                <Ionicons name={icon} size={30} color={colors.sageDeep} />
              </View>
            ))}
          </View>
        ))}
        <LinearGradient
          colors={['rgba(245,246,243,0)', colors.cream, colors.cream]}
          locations={[0, 0.62, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

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
            <View style={styles.logoTile}>
              <Image source={ORBI} style={styles.logoImg} resizeMode="contain" />
            </View>

            <Text style={styles.headline}>Help is one word away</Text>
            <Text style={styles.sub}>Log in or sign up</Text>

            <Pressable
              onPress={handleGoogle}
              disabled={isSigningIn}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.92 }]}
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
              <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="Enter your email"
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
              style={[styles.continue, (!emailOk || sending) && styles.continueOff]}
              accessibilityRole="button"
            >
              <Text style={styles.continueText}>
                {sending ? 'Sending code…' : 'Email me a code'}
              </Text>
            </Pressable>

            {DEV_AUTH.enabled ? (
              <Text style={styles.devHint}>Test mode: OTP is bypassed.</Text>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>

        <View style={styles.terms}>
          <Text style={styles.termsText}>By continuing, you agree to our: </Text>
          <Pressable onPress={() => setPolicyOpen(true)} hitSlop={6}>
            <Text style={styles.termsLink}>Terms & Privacy policy</Text>
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
  flex: { flex: 1 },
  safe: { flex: 1 },

  wall: { position: 'absolute', top: -20, left: 0, right: 0, height: 400 },
  wallRow: { flexDirection: 'row', gap: 14, marginBottom: 14, paddingHorizontal: 14 },
  tile: {
    width: 88,
    height: 88,
    borderRadius: 22,
    backgroundColor: colors.sageSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },

  logoTile: {
    width: 96,
    height: 96,
    borderRadius: 26,
    backgroundColor: colors.sage,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  logoImg: { width: 78, height: 78 },

  headline: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    color: colors.textPrimary,
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  sub: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: spacing.lg,
  },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  gMark: { fontFamily: fontFamilies.poppinsBold, fontSize: 19, color: '#4285F4' },
  googleText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },

  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted },

  emailField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 60,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  input: { flex: 1, fontFamily: fontFamilies.interMedium, fontSize: 16, color: colors.textPrimary },

  continue: {
    height: 58,
    borderRadius: radius.lg,
    backgroundColor: colors.sage,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    ...shadows.hero,
  },
  continueOff: { backgroundColor: '#C9CBC6', shadowOpacity: 0 },
  continueText: { fontFamily: fontFamilies.poppinsBold, fontSize: 16.5, color: colors.textInverse },

  devHint: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  terms: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  termsText: { fontFamily: fontFamilies.interMedium, fontSize: 12, color: colors.textMuted },
  termsLink: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.sageDeep,
    textDecorationLine: 'underline',
  },
});
