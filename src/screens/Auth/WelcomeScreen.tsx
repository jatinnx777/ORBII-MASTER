import React, { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, PrivacyPolicyModal } from '@/components/common';
import { fontFamilies } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { signInFailed, signInStarted, signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { policyAccepted as policyAcceptedNow } from '@/redux/slices/appSlice';
import { signInWithGoogle, sendEmailOtp, DEV_AUTH } from '@/services/auth';
import type { AuthScreenProps } from '@/navigation/types';
import { A, Field, FootLink, OrDivider, PrimaryButton, SocialButton } from './authKit';

const ICON = require('../../../assets/icon-small.png');

/**
 * Sign in. The first screen after onboarding.
 *
 * Restyled to the reference: white ground, orchid social row, labelled field,
 * black pill. The onboarding hands over to this screen two hundred
 * milliseconds after "Allow & finish", so the type and the button geometry are
 * deliberately identical across that boundary.
 *
 * NO GUEST MODE, on purpose. The reference's last onboarding screen offers
 * "Continue with Guest" and that is right for a language app. It is wrong here:
 * an SOS from an account with no identity, no circle and no contacts reaches
 * nobody, so a guest would be worse off than someone who never installed the
 * app while believing they were protected.
 *
 * The wordmark is small and the headline does the work. A giant logo on a sign-in
 * screen is the app talking about itself at the moment the user wants to get in.
 */
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
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <Image source={ICON} style={styles.brandImg} resizeMode="contain" />
            <Text style={styles.brand}>ORBII</Text>
          </View>

          <Text style={styles.headline}>Help is one{'\n'}word away</Text>
          <Text style={styles.sub}>
            Sign in so your circle, your contacts and your alerts stay with you on
            every device.
          </Text>

          <View style={styles.social}>
            <SocialButton
              label={isSigningIn ? 'Signing you in…' : 'Continue with Google'}
              onPress={() => void handleGoogle()}
              busy={isSigningIn}
              icon={<Text style={styles.gMark}>G</Text>}
            />
          </View>

          <OrDivider label="Or continue with email" />

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            keyboardType="email-address"
            autoCorrect={false}
          />

          <PrimaryButton
            label={sending ? 'Sending code…' : 'Email me a code'}
            onPress={() => void handleEmail()}
            busy={sending}
            disabled={!emailOk}
          />

          {/* The promise, restated where the decision is made. This is the one
              line that earns the microphone permission the app just asked for. */}
          <View style={styles.reassure}>
            <Ionicons name="lock-closed" size={13} color={A.ink} />
            <Text style={styles.reassureText}>
              Your voice stays on your phone. It is never uploaded and never sold.
            </Text>
          </View>

          {DEV_AUTH.enabled ? <Text style={styles.dev}>Test mode: OTP is bypassed.</Text> : null}

          <FootLink
            text="By continuing you agree to our"
            actionLabel="Terms & Privacy"
            onPress={() => setPolicyOpen(true)}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <PrivacyPolicyModal
        visible={policyOpen}
        onAccept={() => {
          dispatch(policyAcceptedNow());
          setPolicyOpen(false);
        }}
        onDecline={() => setPolicyOpen(false)}
      />
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  scroll: { paddingHorizontal: 26, paddingTop: 18, paddingBottom: 28 },

  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 30 },
  brandImg: { width: 30, height: 30, borderRadius: 8 },
  brand: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    letterSpacing: 1,
    color: A.ink,
  },

  headline: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 30,
    lineHeight: 38,
    letterSpacing: -0.6,
    color: A.ink,
  },
  sub: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 13.5,
    lineHeight: 21,
    color: A.body,
    marginTop: 10,
    marginBottom: 26,
  },

  social: { marginBottom: 2 },
  gMark: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: '#FFFFFF' },

  reassure: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    marginTop: 22,
    paddingHorizontal: 2,
  },
  reassureText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 12,
    lineHeight: 18,
    color: A.body,
  },
  dev: {
    fontFamily: fontFamilies.poppinsRegular,
    fontSize: 11.5,
    color: A.body,
    textAlign: 'center',
    marginTop: 14,
  },
});
