import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, radius, spacing, weight } from '../theme';
import { sendCode, verifyCode } from '../services/auth';

/**
 * Two steps, one field each. Email, then the six digit code.
 *
 * The person signing in here is often a parent doing it once, at the request
 * of their daughter, on a phone they are not fond of. Every extra field is a
 * chance for them to give up, and if they give up they are not reachable on
 * the night it matters.
 */
export function SignInScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submitEmail = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await sendCode(email);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? 'Could not send the code. Check your connection.');
      return;
    }
    setSent(true);
  };

  const submitCode = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await verifyCode(email, code);
    setBusy(false);
    if (!r.ok) {
      setError(r.message ?? 'That code did not work. Try again.');
      return;
    }
    onDone();
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.mark}>ORBII</Text>
          <Text style={styles.title}>Circle</Text>
          <Text style={styles.blurb}>
            For the people someone trusts. You will be told the moment they raise an alarm, and
            you can say what you are doing about it.
          </Text>

          {!sent ? (
            <>
              <Text style={styles.label}>Your email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                style={styles.input}
                onSubmitEditing={() => void submitEmail()}
                returnKeyType="go"
              />
              <Pressable
                onPress={() => void submitEmail()}
                disabled={busy}
                style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.ctaText}>Send me a code</Text>
                )}
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>The six digit code we emailed you</Text>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                style={[styles.input, styles.codeInput]}
                onSubmitEditing={() => void submitCode()}
                returnKeyType="go"
                autoFocus
              />
              <Pressable
                onPress={() => void submitCode()}
                disabled={busy}
                style={({ pressed }) => [styles.cta, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.ctaText}>Sign in</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setSent(false)} hitSlop={10}>
                <Text style={styles.back}>Use a different email</Text>
              </Pressable>
            </>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: spacing.lg, paddingTop: spacing.xxl, gap: spacing.sm },
  mark: {
    fontSize: 13,
    fontWeight: weight.bold,
    letterSpacing: 3,
    color: colors.textSecondary,
  },
  title: {
    fontSize: 40,
    fontWeight: weight.bold,
    letterSpacing: -1,
    color: colors.textPrimary,
    marginTop: 2,
  },
  blurb: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    marginBottom: spacing.xl,
  },
  label: {
    fontSize: 13,
    fontWeight: weight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.textPrimary,
  },
  codeInput: { fontSize: 24, letterSpacing: 6, textAlign: 'center', fontWeight: weight.semibold },
  cta: {
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.brandDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  ctaText: { color: colors.textInverse, fontSize: 16, fontWeight: weight.semibold },
  pressed: { opacity: 0.9 },
  back: {
    textAlign: 'center',
    color: colors.brandDeep,
    fontSize: 14,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  error: {
    color: colors.coralDeep,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.md,
  },
});
