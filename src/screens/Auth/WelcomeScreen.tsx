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
import { signInWithGoogle, sendOtpToE164, sendEmailOtp, DEV_AUTH } from '@/services/auth';
import { CountryPickerSheet } from './CountryPickerSheet';
import { DEFAULT_COUNTRY, type Country } from './countries';
import type { AuthScreenProps } from '@/navigation/types';

const ORBI = require('../../../assets/onboarding/orbi-hero.png');

// Phone-first sign in. Mobile + OTP is the primary path (that's how India logs
// in), with email OTP and Google as fallbacks. A safety app deliberately has no
// "skip login" — an SOS with no identity reaches nobody.

// The soft tile wall behind the sheet: what ORBII actually does, as icons.
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY);
  const [mode, setMode] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const expected = country.len ?? 0;
  const phoneOk = expected ? phone.length === expected : phone.length >= 6;
  const emailOk = /^\S+@\S+\.\S+$/.test(email.trim());
  const ready = (mode === 'phone' ? phoneOk : emailOk) && !sending;

  const handleContinue = async () => {
    if (!ready) return;
    if (!policyOk) {
      setPolicyOpen(true);
      return;
    }
    setSending(true);
    try {
      if (mode === 'phone') {
        const e164 = await sendOtpToE164(`${country.dial}${phone}`);
        navigation.navigate('PhoneVerify', { phone: e164 });
      } else {
        const addr = await sendEmailOtp(email);
        navigation.navigate('PhoneVerify', { email: addr });
      }
    } catch (err) {
      appAlert(
        "Couldn't send the code",
        err instanceof Error ? err.message : 'Please try again in a moment.',
      );
    } finally {
      setSending(false);
    }
  };

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
      if (needsProfile) navigation.reset({ index: 0, routes: [{ name: 'ProfileSetup' }] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Google sign-in failed.';
      dispatch(signInFailed({ error: message }));
      if (!/cancel/i.test(message)) appAlert("Couldn't sign in", message);
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
        <View style={styles.topRow}>
          <View />
          <Pressable
            onPress={() => setMode((m) => (m === 'phone' ? 'email' : 'phone'))}
            style={styles.switchPill}
            hitSlop={8}
          >
            <Ionicons
              name={mode === 'phone' ? 'mail-outline' : 'call-outline'}
              size={14}
              color={colors.textSecondary}
            />
            <Text style={styles.switchText}>
              {mode === 'phone' ? 'Use email' : 'Use phone'}
            </Text>
          </Pressable>
        </View>

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

            {mode === 'phone' ? (
              <View style={styles.inputRow}>
                <Pressable style={styles.countryBtn} onPress={() => setPickerOpen(true)}>
                  <Text style={styles.flag}>{country.flag}</Text>
                  <Ionicons name="chevron-down" size={15} color={colors.textSecondary} />
                </Pressable>
                <View style={styles.phoneField}>
                  <Text style={styles.dial}>{country.dial}</Text>
                  <TextInput
                    value={phone}
                    onChangeText={(v) =>
                      setPhone(v.replace(/\D/g, '').slice(0, country.len ?? 14))
                    }
                    placeholder="Enter mobile number"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="number-pad"
                    style={styles.input}
                  />
                </View>
              </View>
            ) : (
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
            )}

            <Pressable
              onPress={handleContinue}
              disabled={!ready}
              style={[styles.continue, !ready && styles.continueOff]}
              accessibilityRole="button"
            >
              <Text style={[styles.continueText, !ready && styles.continueTextOff]}>
                {sending ? 'Sending code…' : 'Continue'}
              </Text>
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.or}>or</Text>
              <View style={styles.line} />
            </View>

            <Pressable
              onPress={handleGoogle}
              disabled={isSigningIn}
              style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.gMark}>G</Text>
              <Text style={styles.googleText}>
                {isSigningIn ? 'Signing you in…' : 'Continue with Google'}
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

      <CountryPickerSheet
        visible={pickerOpen}
        selected={country}
        onSelect={(c) => {
          setCountry(c);
          setPhone('');
        }}
        onClose={() => setPickerOpen(false)}
      />

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

  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  switchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    ...shadows.icon,
  },
  switchText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },

  scroll: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: spacing.lg, paddingBottom: spacing.md },

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

  inputRow: { flexDirection: 'row', gap: spacing.sm },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 60,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
  },
  flag: { fontSize: 24 },
  phoneField: {
    flex: 1,
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
  dial: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 16, color: colors.textPrimary },
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
  continueTextOff: { color: '#FFFFFF' },

  divider: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  or: { fontFamily: fontFamilies.interMedium, fontSize: 13, color: colors.textMuted },

  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    ...shadows.icon,
  },
  gMark: { fontFamily: fontFamilies.poppinsBold, fontSize: 18, color: '#4285F4' },
  googleText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },

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
