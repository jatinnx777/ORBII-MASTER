import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { Step } from '@/components/onboarding/Step';
import { useAppDispatch } from '@/redux/store';
import { signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { sendEmailOtp, signInWithGoogle, verifyEmailOtp } from '@/services/auth';

/**
 * Signing back in. Two screens, and deliberately not the eight-step first run.
 *
 * WHY THIS EXISTS. Somebody who signs out used to land on WelcomeScreen, which
 * was written before the flow was rebuilt and looks like a different app. So
 * the worst-looking screen in ORBII was the one shown to the people who had
 * already decided to use it.
 *
 * It reuses the same Step shell as first run, in bare mode: no progress bar, no
 * "2 of 8". A returning user is doing one thing, and a progress bar over it
 * invents a journey she is not on.
 *
 * She keeps everything. Her contacts, her circle, her PIN and her history are
 * on the server and come back with the session, so there is nothing to set up
 * again and nothing here pretends otherwise.
 */
export function SignInScreen() {
  const dispatch = useAppDispatch();

  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  if (stage === 'email') {
    return (
      <Step
        bare
        index={1}
        total={2}
        icon="log-in"
        tint={colors.brandDeep}
        title="Welcome back"
        blurb="Everything you set up is still here. Sign in and it comes straight back."
        ctaLabel="Email me a code"
        ctaDisabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
        busy={busy}
        onNext={async () => {
          setBusy(true);
          try {
            await sendEmailOtp(email);
          } catch {
            // A bad address surfaces on the code screen rather than trapping
            // her here with an error she cannot act on.
          } finally {
            setBusy(false);
            setStage('code');
          }
        }}
      >
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await signInWithGoogle();
              dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
              dispatch(historyHydrated(r.history));
            } catch (err) {
              const m = err instanceof Error ? err.message : 'Google sign-in failed.';
              if (!/cancel/i.test(m)) Alert.alert('Could not sign in', m);
            } finally {
              setBusy(false);
            }
          }}
          style={({ pressed }) => [s.google, pressed && { opacity: 0.9 }]}
          accessibilityRole="button"
        >
          <Ionicons name="logo-google" size={19} color={colors.textPrimary} />
          <Text style={s.googleText}>Continue with Google</Text>
        </Pressable>

        <View style={s.orRow}>
          <View style={s.orLine} />
          <Text style={s.orText}>or</Text>
          <View style={s.orLine} />
        </View>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor={colors.textMuted}
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
        />
      </Step>
    );
  }

  return (
    <Step
      bare
      index={2}
      total={2}
      icon="keypad"
      tint={colors.brandDeep}
      title="Check your email"
      blurb={email.trim().toLowerCase()}
      ctaLabel="Sign in"
      ctaDisabled={code.replace(/\D/g, '').length < 6}
      busy={busy}
      onBack={() => setStage('email')}
      onNext={async () => {
        setBusy(true);
        try {
          const r = await verifyEmailOtp(email, code);
          dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
          dispatch(historyHydrated(r.history));
        } catch (err) {
          Alert.alert(
            'That code did not work',
            err instanceof Error ? err.message : 'Try again.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      {/* Eight, not six. Supabase issues an 8 digit code on this project. */}
      <TextInput
        value={code}
        onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
        placeholder="12345678"
        placeholderTextColor={colors.textMuted}
        style={[s.input, s.code]}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        maxLength={8}
        autoFocus
      />
    </Step>
  );
}

const s = StyleSheet.create({
  input: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontFamily: fontFamilies.interRegular,
    fontSize: 16,
    color: colors.textPrimary,
  },
  code: {
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    fontFamily: fontFamilies.poppinsSemiBold,
  },
  google: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: 54,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  googleText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: colors.border },
  orText: { fontFamily: fontFamilies.interRegular, fontSize: 13, color: colors.textMuted },
});
