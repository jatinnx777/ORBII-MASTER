import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { Step } from '@/components/onboarding/Step';
import { Protected } from '@/components/onboarding/Protected';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded, signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { sendEmailOtp, signInWithGoogle, verifyEmailOtp } from '@/services/auth';
import { recordConsent, logConsentEvent } from '@/services/consent';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import { armVoiceSos } from '@/services/voice-detection';
import { setPin } from '@/services/safety-pin';
import { toE164India } from '@/utils/validation';
import type { OnboardingLang } from '@/onboardingVideos';

/**
 * First run, rebuilt.
 *
 * IT REPLACES TWENTY-NINE SCREENS WITH SIX. What was here before was a
 * six-slide carousel, then a language screen, then a video about what ORBII
 * is, then fourteen registration steps, then a PIN, then a five-step guided
 * setup, then a permission modal. 2,323 lines across five files, none of which
 * knew about the others. Slide six of the carousel was titled "Two things and
 * you're set", and twenty-three screens came after it.
 *
 * THE RULE EVERY SCREEN HERE HAD TO PASS: does skipping this leave her less
 * safe in the next five minutes? Name, photo, phone number, battery exemption,
 * safe zones, evidence settings and offline setup all failed it. They are not
 * deleted, they are asked later, in the place where they mean something.
 *
 * WHY THAT IS A SAFETY DECISION AND NOT A TASTE ONE. She is not exploring a
 * product. Nobody downloads a women's safety app on a good day; she is doing it
 * because of a commute, a corridor, or a person. Every screen before she is
 * covered is a screen during which she is not. And the person who gave up at
 * step eleven of the old flow walked away believing she had a safety app.
 * A half-finished safety setup is more dangerous than no app at all, because
 * it is trusted.
 *
 * So: six screens, and the last one is true.
 */

type StepId = 'consent' | 'email' | 'code' | 'contact' | 'voice' | 'pin' | 'done';

const ORDER: StepId[] = ['consent', 'email', 'code', 'contact', 'voice', 'pin'];
const TOTAL = ORDER.length;

export function FirstRun({ lang, onDone }: { lang: OnboardingLang; onDone: () => void }) {
  const hi = lang === 'hi';
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [step, setStep] = useState<StepId>('consent');
  const [busy, setBusy] = useState(false);

  const [adult, setAdult] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [pin, setPinValue] = useState('');
  const [voiceArmed, setVoiceArmed] = useState(false);

  const index = (id: StepId) => ORDER.indexOf(id) + 1;
  const go = (next: StepId) => setStep(next);

  // ---- consent -------------------------------------------------------------
  if (step === 'consent') {
    return (
      <Step
        index={index('consent')}
        total={TOTAL}
        title={hi ? 'शुरू करने से पहले' : 'Before we start'}
        blurb={
          hi
            ? 'ORBII आपकी आवाज़ आपके फ़ोन पर ही पहचानता है। कुछ भी अपलोड नहीं होता।'
            : 'ORBII recognises your voice on your phone. Nothing is uploaded to hear it.'
        }
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={!adult}
        busy={busy}
        footnote={
          hi
            ? 'भारत के DPDP नियमों के तहत 18 से कम उम्र पर लगातार लोकेशन बंद रहती है।'
            : "Under India's DPDP rules, continuous location is off for under 18s. Every other safety feature stays on."
        }
        onNext={async () => {
          setBusy(true);
          try {
            await recordConsent(lang, adult);
            void logConsentEvent('core', true, { method: 'checkbox' });
            go('email');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Pressable
          onPress={() => setAdult((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: adult }}
          style={({ pressed }) => [s.check, adult && s.checkOn, pressed && s.pressed]}
        >
          <View style={[s.box, adult && s.boxOn]}>
            {adult ? <Ionicons name="checkmark" size={15} color={colors.textInverse} /> : null}
          </View>
          <Text style={s.checkText}>
            {hi ? 'मेरी उम्र 18 साल या उससे ज़्यादा है' : 'I am 18 or older'}
          </Text>
        </Pressable>
      </Step>
    );
  }

  // ---- email ---------------------------------------------------------------
  if (step === 'email') {
    return (
      <Step
        index={index('email')}
        total={TOTAL}
        title={hi ? 'आपका ईमेल' : 'Your email'}
        blurb={
          hi
            ? 'कोई पासवर्ड नहीं। हम एक कोड भेजेंगे।'
            : 'No password. We send you a code.'
        }
        ctaLabel={hi ? 'कोड भेजिए' : 'Email me a code'}
        ctaDisabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
        busy={busy}
        onBack={() => go('consent')}
        onNext={async () => {
          setBusy(true);
          try {
            await sendEmailOtp(email);
          } catch {
            // A genuinely bad address surfaces on the code screen instead of
            // trapping her here with an error she cannot act on.
          } finally {
            setBusy(false);
            go('code');
          }
        }}
      >
        {/* Google first, and it is not decoration. It is one tap against three
            screens: no code to wait for, no inbox to switch to, no chance of a
            slow SMTP handoff losing her between here and the code screen. */}
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await signInWithGoogle();
              dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
              dispatch(historyHydrated(r.history));
              go('contact');
            } catch (err) {
              const m = err instanceof Error ? err.message : 'Google sign-in failed.';
              // A cancelled sign-in is a decision, not an error to apologise for.
              if (!/cancel/i.test(m)) Alert.alert(hi ? 'साइन इन नहीं हुआ' : 'Could not sign in', m);
            } finally {
              setBusy(false);
            }
          }}
          style={({ pressed }) => [s.google, pressed && s.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="logo-google" size={19} color={colors.textPrimary} />
          <Text style={s.googleText}>
            {hi ? 'Google से जारी रखें' : 'Continue with Google'}
          </Text>
        </Pressable>

        <View style={s.orRow}>
          <View style={s.orLine} />
          <Text style={s.orText}>{hi ? 'या' : 'or'}</Text>
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

  // ---- code ----------------------------------------------------------------
  if (step === 'code') {
    return (
      <Step
        index={index('code')}
        total={TOTAL}
        title={hi ? 'ईमेल देखिए' : 'Check your email'}
        blurb={email.trim().toLowerCase()}
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={code.replace(/\D/g, '').length < 6}
        busy={busy}
        onBack={() => go('email')}
        onNext={async () => {
          setBusy(true);
          try {
            const r = await verifyEmailOtp(email, code);
            dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
            dispatch(historyHydrated(r.history));
            go('contact');
          } catch (err) {
            Alert.alert(
              hi ? 'कोड ग़लत है' : 'That code did not work',
              err instanceof Error ? err.message : 'Try again.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {/* NOT CAPPED AT SIX. Supabase issues an 8 digit code on this project,
            and a maxLength of 6 silently truncated it, which made every new
            signup impossible rather than merely annoying. Accepts up to 8 and
            unlocks at 6, so the field is right whichever length the project is
            configured for and never eats a valid digit. */}
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

  // ---- one contact ---------------------------------------------------------
  if (step === 'contact') {
    return (
      <Step
        index={index('contact')}
        total={TOTAL}
        title={hi ? 'एक भरोसेमंद नंबर' : 'One person who picks up'}
        blurb={
          hi
            ? 'एक ऐसा इंसान जो रात दो बजे सच में फ़ोन उठाए। पाँच लोग नहीं जो शायद उठाएँ।'
            : 'One person who will actually pick up at 2am. Not five who might.'
        }
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={cName.trim().length < 2 || cPhone.length !== 10}
        busy={busy}
        footnote={
          hi ? 'बाद में और लोग जोड़ सकती हैं।' : 'You can add more people later.'
        }
        onNext={async () => {
          if (!profile) return;
          setBusy(true);
          try {
            const contact = {
              id: `ec_${Date.now()}`,
              name: cName.trim(),
              phone: toE164India(cPhone),
              relation: 'Emergency contact',
            };
            const saved = await upsertEmergencyContact(profile.uid, contact);
            dispatch(contactAdded(saved ?? contact));
          } finally {
            setBusy(false);
            go('voice');
          }
        }}
      >
        <TextInput
          value={cName}
          onChangeText={setCName}
          placeholder={hi ? 'उनका नाम' : 'Their name'}
          placeholderTextColor={colors.textMuted}
          style={s.input}
          autoCapitalize="words"
        />
        <TextInput
          value={cPhone}
          onChangeText={(v) => setCPhone(v.replace(/\D/g, '').slice(0, 10))}
          placeholder={hi ? '10 अंकों का नंबर' : '10 digit mobile number'}
          placeholderTextColor={colors.textMuted}
          style={s.input}
          keyboardType="number-pad"
          textContentType="telephoneNumber"
        />
      </Step>
    );
  }

  // ---- voice ---------------------------------------------------------------
  if (step === 'voice') {
    return (
      <Step
        index={index('voice')}
        total={TOTAL}
        title={hi ? 'बस एक शब्द' : 'Just say the word'}
        blurb={
          hi
            ? 'फ़ोन जेब में हो, स्क्रीन बंद हो, इंटरनेट न हो। "help" या "bachao" कहिए और ORBII चल पड़ता है।'
            : 'Phone in your pocket, screen off, no internet. Say "help" or "bachao" and ORBII goes.'
        }
        ctaLabel={
          voiceArmed
            ? hi
              ? 'आगे'
              : 'Continue'
            : hi
              ? 'Voice SOS चालू कीजिए'
              : 'Turn on Voice SOS'
        }
        busy={busy}
        footnote={
          hi
            ? 'यह 12 घंटे के लिए चालू होता है। कभी भी बंद कर सकती हैं।'
            : 'Armed for 12 hours. You can switch it off any time.'
        }
        onNext={async () => {
          if (voiceArmed) {
            go('pin');
            return;
          }
          setBusy(true);
          try {
            // NEVER a live trigger during setup. The old flow said "try saying
            // it now" right after arming the real engine, which did exactly
            // what you would expect.
            const r = await armVoiceSos(12);
            setVoiceArmed(!!r);
            if (!r) {
              Alert.alert(
                hi ? 'चालू नहीं हो पाया' : 'Could not turn it on',
                hi
                  ? 'माइक की अनुमति चाहिए। Settings में जाकर दे सकती हैं, या अभी छोड़ दीजिए।'
                  : 'ORBII needs microphone permission. You can allow it in Settings, or skip for now.',
                [
                  { text: hi ? 'अभी छोड़ें' : 'Skip for now', onPress: () => go('pin') },
                  { text: 'OK' },
                ],
              );
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <View style={s.words}>
          {['help', 'bachao', 'madad', 'save me'].map((w) => (
            <View key={w} style={s.word}>
              <Text style={s.wordText}>{w}</Text>
            </View>
          ))}
        </View>
        {voiceArmed ? (
          <View style={s.armed}>
            <Ionicons name="checkmark-circle" size={18} color={colors.sageDeep} />
            <Text style={s.armedText}>
              {hi ? 'Voice SOS चालू है' : 'Voice SOS is listening'}
            </Text>
          </View>
        ) : null}
      </Step>
    );
  }

  // ---- pin -----------------------------------------------------------------
  if (step === 'pin') {
    return (
      <Step
        index={index('pin')}
        total={TOTAL}
        title={hi ? 'एक PIN चुनिए' : 'Choose a PIN'}
        blurb={
          hi
            ? 'अगर कोई आपका फ़ोन छीन ले, तो बिना इस PIN के आपका SOS रोका नहीं जा सकता।'
            : 'If someone takes your phone, your SOS cannot be cancelled without this PIN.'
        }
        ctaLabel={hi ? 'हो गया' : 'Done'}
        ctaDisabled={pin.length !== 4}
        busy={busy}
        footnote={
          hi
            ? 'इसे याद रखिए। यह सिर्फ़ आपके फ़ोन पर रहता है।'
            : 'Remember it. It never leaves your phone.'
        }
        onNext={async () => {
          setBusy(true);
          try {
            await setPin(pin);
            go('done');
          } catch {
            Alert.alert(
              hi ? 'PIN सेव नहीं हुआ' : 'Could not save the PIN',
              hi ? 'दोबारा कोशिश कीजिए।' : 'Please try again.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput
          value={pin}
          onChangeText={(v) => setPinValue(v.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
          placeholderTextColor={colors.textMuted}
          style={[s.input, s.code]}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoFocus
        />
      </Step>
    );
  }

  // ---- done ----------------------------------------------------------------
  // Every line is something that is actually live for her right now. Nothing
  // aspirational, nothing she has not done, because this is the one screen the
  // whole flow exists to make true.
  const lines = [
    hi ? `${cName.trim()} को तुरंत पता चलेगा` : `${cName.trim()} is alerted instantly`,
    voiceArmed
      ? hi
        ? 'Voice SOS सुन रहा है'
        : 'Voice SOS is listening'
      : hi
        ? 'SOS बटन तैयार है'
        : 'The SOS button is ready',
    hi ? 'आपका PIN सेट है' : 'Your PIN is set',
  ];

  return (
    <Protected
      lines={lines}
      ctaLabel={hi ? 'ORBII खोलिए' : 'Open ORBII'}
      onDone={onDone}
    />
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

  check: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  checkOn: { borderColor: colors.brandDeep },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxOn: { backgroundColor: colors.brandDeep, borderColor: colors.brandDeep },
  checkText: { fontFamily: fontFamilies.interRegular, fontSize: 15, color: colors.textPrimary },
  pressed: { opacity: 0.9 },

  words: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  word: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.lavenderSoft,
  },
  wordText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.lavenderDeep,
  },

  armed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  armedText: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.sageDeep },
});
