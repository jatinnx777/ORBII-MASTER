import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamilies, radius, spacing } from '@/theme';
import { Step } from '@/components/onboarding/Step';
import { Protected } from '@/components/onboarding/Protected';
import { Listening } from '@/components/onboarding/Listening';
import { PermissionCards } from '@/components/onboarding/PermissionCards';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded, profileUpdated, signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import { sendEmailOtp, signInWithGoogle, updateProfile, verifyEmailOtp } from '@/services/auth';
import { recordConsent, logConsentEvent } from '@/services/consent';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import { armVoiceSos } from '@/services/voice-detection';
import { setPin } from '@/services/safety-pin';
import { acceptInviteByToken } from '@/services/circles';
import { toE164India } from '@/utils/validation';
import type { OnboardingLang } from '@/onboardingVideos';

/**
 * First run.
 *
 * IT REPLACED TWENTY-NINE SCREENS: a six-slide carousel, a language screen, a
 * video, fourteen registration steps, a PIN, and a five-step guided setup, in
 * 2,323 lines across five files that did not know about each other. Slide six
 * of the carousel was titled "Two things and you're set", and twenty-three
 * screens came after it.
 *
 * THE RULE EVERY SCREEN PASSES: does skipping it leave her less safe in the
 * next five minutes? Photo, username, safe zones, evidence settings and offline
 * setup all failed it and are asked later, where they mean something.
 *
 * WHY THAT IS A SAFETY DECISION. Nobody downloads a women's safety app on a
 * good day. Every screen before she is covered is a screen during which she is
 * not, and whoever gave up at step eleven of the old flow walked away believing
 * she had a safety app. A half-finished safety setup is more dangerous than
 * none, because it is trusted.
 *
 * TWO THINGS THE SPEC ASKED FOR THAT ARE NOT HERE, both deliberate:
 *
 *   PHONE AS THE LOGIN. sendPhoneOtp exists and cannot work: Supabase Phone
 *   Auth needs an SMS provider and none is wired, which is exactly why auth.ts
 *   retired that path. A phone-OTP screen would be a beautiful form that can
 *   never send a message. The number is still collected, as her emergency
 *   contact's, which is what it is actually for.
 *
 *   DROPPING THE PIN. The spec's five steps have no PIN. It stays, because it
 *   is the only thing stopping somebody who grabs her phone from tapping
 *   cancel on her own SOS.
 */

type StepId =
  | 'consent'
  | 'auth'
  | 'code'
  | 'profile'
  | 'permissions'
  | 'voice'
  | 'circle'
  | 'pin'
  | 'done';

const ORDER: StepId[] = [
  'consent',
  'auth',
  'code',
  'profile',
  'permissions',
  'voice',
  'circle',
  'pin',
];
const TOTAL = ORDER.length;

const ROLES = ['Parent', 'Friend', 'Partner', 'Sibling', 'Guardian'] as const;

export function FirstRun({ lang, onDone }: { lang: OnboardingLang; onDone: () => void }) {
  const hi = lang === 'hi';
  const dispatch = useAppDispatch();
  const profile = useAppSelector((st) => st.user.profile);

  const [step, setStep] = useState<StepId>('consent');
  const [busy, setBusy] = useState(false);

  const [adult, setAdult] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [cName, setCName] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [role, setRole] = useState<string>('Parent');
  const [perms, setPerms] = useState<string[]>([]);
  const [voiceArmed, setVoiceArmed] = useState(false);
  const [invite, setInvite] = useState('');
  const [joined, setJoined] = useState(false);
  const [pin, setPinValue] = useState('');

  const index = (id: StepId) => ORDER.indexOf(id) + 1;
  const go = (next: StepId) => setStep(next);
  const common = (id: StepId) => ({ index: index(id), total: TOTAL, busy });

  // ---- consent -------------------------------------------------------------
  if (step === 'consent') {
    return (
      <Step
        {...common('consent')}
        icon="lock-closed"
        tint={colors.lavenderDeep}
        title={hi ? 'शुरू करने से पहले' : 'Welcome to ORBII'}
        blurb={
          hi
            ? 'ORBII आपकी आवाज़ आपके फ़ोन पर ही पहचानता है। कुछ भी अपलोड नहीं होता।'
            : 'Silent, hands-free protection for the people you trust. Your voice is recognised on your phone and never uploaded.'
        }
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={!adult}
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
            go('auth');
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

  // ---- auth ----------------------------------------------------------------
  if (step === 'auth') {
    return (
      <Step
        {...common('auth')}
        icon="mail"
        tint={colors.brandDeep}
        title={hi ? 'आपका ईमेल' : 'Create your account'}
        blurb={hi ? 'कोई पासवर्ड नहीं। हम एक कोड भेजेंगे।' : 'No password. We send you a code.'}
        ctaLabel={hi ? 'कोड भेजिए' : 'Email me a code'}
        ctaDisabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
        onBack={() => go('consent')}
        onNext={async () => {
          setBusy(true);
          try {
            await sendEmailOtp(email);
          } catch {
            // A bad address surfaces on the code screen rather than trapping
            // her here with an error she cannot act on.
          } finally {
            setBusy(false);
            go('code');
          }
        }}
      >
        {/* Google first. One tap against three screens: no code to wait for, no
            inbox to switch to, no slow SMTP handoff losing her in between. */}
        <Pressable
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await signInWithGoogle();
              dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
              dispatch(historyHydrated(r.history));
              setName(r.profile.name ?? '');
              go('profile');
            } catch (err) {
              const m = err instanceof Error ? err.message : 'Google sign-in failed.';
              if (!/cancel/i.test(m)) Alert.alert(hi ? 'साइन इन नहीं हुआ' : 'Could not sign in', m);
            } finally {
              setBusy(false);
            }
          }}
          style={({ pressed }) => [s.google, pressed && s.pressed]}
          accessibilityRole="button"
        >
          <Ionicons name="logo-google" size={19} color={colors.textPrimary} />
          <Text style={s.googleText}>{hi ? 'Google से जारी रखें' : 'Continue with Google'}</Text>
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
        {...common('code')}
        icon="keypad"
        tint={colors.brandDeep}
        title={hi ? 'ईमेल देखिए' : 'Check your email'}
        blurb={email.trim().toLowerCase()}
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={code.replace(/\D/g, '').length < 6}
        onBack={() => go('auth')}
        onNext={async () => {
          setBusy(true);
          try {
            const r = await verifyEmailOtp(email, code);
            dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
            dispatch(historyHydrated(r.history));
            setName(r.profile.name ?? '');
            go('profile');
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
        {/* Not capped at six. Supabase issues an 8 digit code on this project,
            and a maxLength of 6 silently ate the last two, which made signup
            impossible rather than merely annoying. */}
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

  // ---- profile and the one contact ----------------------------------------
  if (step === 'profile') {
    return (
      <Step
        {...common('profile')}
        icon="person-add"
        tint={colors.sageDeep}
        title={hi ? 'एक भरोसेमंद नंबर' : 'One person who picks up'}
        blurb={
          hi
            ? 'एक ऐसा इंसान जो रात दो बजे सच में फ़ोन उठाए। पाँच लोग नहीं जो शायद उठाएँ।'
            : 'One person who will actually pick up at 2am. Not five who might.'
        }
        ctaLabel={hi ? 'आगे' : 'Continue'}
        ctaDisabled={name.trim().length < 2 || cName.trim().length < 2 || cPhone.length !== 10}
        onBack={() => go('code')}
        onNext={async () => {
          if (!profile) return;
          setBusy(true);
          try {
            // Her name is not vanity. Without it the alert her mother receives
            // says "Someone needs help".
            if (name.trim() && name.trim() !== profile.name) {
              const updated = await updateProfile(profile, {
                name: name.trim(),
                photoUri: profile.photoUri ?? null,
              }).catch(() => null);
              if (updated) dispatch(profileUpdated(updated));
            }
            const contact = {
              id: `ec_${Date.now()}`,
              name: cName.trim(),
              phone: toE164India(cPhone),
              relation: role,
            };
            const saved = await upsertEmergencyContact(profile.uid, contact);
            dispatch(contactAdded(saved ?? contact));
          } finally {
            setBusy(false);
            go('permissions');
          }
        }}
      >
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={hi ? 'आपका नाम' : 'Your name'}
          placeholderTextColor={colors.textMuted}
          style={s.input}
          autoCapitalize="words"
        />
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
        <View style={s.chips}>
          {ROLES.map((r) => (
            <Pressable
              key={r}
              onPress={() => setRole(r)}
              accessibilityRole="radio"
              accessibilityState={{ selected: role === r }}
              style={[s.chip, role === r && s.chipOn]}
            >
              <Text style={[s.chipText, role === r && s.chipTextOn]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      </Step>
    );
  }

  // ---- permissions ---------------------------------------------------------
  if (step === 'permissions') {
    return (
      <Step
        {...common('permissions')}
        icon="shield-half"
        tint={colors.goldDeep}
        title={hi ? 'ORBII को चालू रखिए' : 'Turn ORBII on'}
        blurb={
          hi
            ? 'हर एक के लिए वजह पहले, फिर फ़ोन पूछेगा। कोई भी छोड़ सकती हैं।'
            : 'The reason first, then your phone asks. You can skip any of them.'
        }
        ctaLabel={
          perms.length === 0 ? (hi ? 'अभी छोड़ें' : 'Skip for now') : hi ? 'आगे' : 'Continue'
        }
        onBack={() => go('profile')}
        onNext={() => go('voice')}
      >
        <PermissionCards onChange={(g) => setPerms(g)} />
      </Step>
    );
  }

  // ---- voice ---------------------------------------------------------------
  if (step === 'voice') {
    return (
      <Step
        {...common('voice')}
        icon="mic"
        tint={colors.coralDeep}
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
        onBack={() => go('permissions')}
        footnote={
          hi
            ? 'यह 12 घंटे के लिए चालू होता है। कभी भी बंद कर सकती हैं।'
            : 'Armed for 12 hours. You can switch it off any time.'
        }
        onNext={async () => {
          if (voiceArmed) {
            go('circle');
            return;
          }
          setBusy(true);
          try {
            // NEVER a live trigger during setup. The old flow said "try saying
            // it now" right after arming the real engine.
            const r = await armVoiceSos(12);
            setVoiceArmed(!!r);
            if (!r) {
              Alert.alert(
                hi ? 'चालू नहीं हो पाया' : 'Could not turn it on',
                hi ? 'माइक की अनुमति चाहिए।' : 'ORBII needs microphone permission for this.',
                [
                  { text: hi ? 'अभी छोड़ें' : 'Skip for now', onPress: () => go('circle') },
                  { text: 'OK' },
                ],
              );
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        <Listening armed={voiceArmed} words={['help', 'bachao', 'madad', 'save me']} />
      </Step>
    );
  }

  // ---- circle --------------------------------------------------------------
  if (step === 'circle') {
    return (
      <Step
        {...common('circle')}
        icon="people"
        tint={colors.lavenderDeep}
        title={hi ? 'आपका circle' : 'Your circle'}
        blurb={
          hi
            ? 'अगर किसी ने आपको invite किया है तो code डालिए। नहीं तो यह बाद में हो सकता है।'
            : 'If someone sent you an invite, enter the code. If not, this can wait.'
        }
        ctaLabel={
          joined
            ? hi
              ? 'आगे'
              : 'Continue'
            : invite.trim()
              ? hi
                ? 'जुड़िए'
                : 'Join'
              : hi
                ? 'बाद में'
                : 'Later'
        }
        onBack={() => go('voice')}
        onNext={async () => {
          if (joined || !invite.trim()) {
            go('pin');
            return;
          }
          setBusy(true);
          try {
            await acceptInviteByToken(invite.trim());
            setJoined(true);
          } catch (err) {
            Alert.alert(
              hi ? 'Code काम नहीं आया' : 'That code did not work',
              err instanceof Error ? err.message : 'Check it and try again.',
            );
          } finally {
            setBusy(false);
          }
        }}
        footnote={
          hi
            ? 'Circle बनाना और लोगों को बुलाना बाद में Circles tab से कर सकती हैं।'
            : 'You can create a circle and invite people from the Circles tab any time.'
        }
      >
        {joined ? (
          <View style={s.joined}>
            <Ionicons name="checkmark-circle" size={20} color={colors.sageDeep} />
            <Text style={s.joinedText}>{hi ? 'आप जुड़ गईं' : 'You are in'}</Text>
          </View>
        ) : (
          <TextInput
            value={invite}
            onChangeText={(v) => setInvite(v.trim())}
            placeholder="Invite code"
            placeholderTextColor={colors.textMuted}
            style={[s.input, s.invite]}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        )}
      </Step>
    );
  }

  // ---- pin -----------------------------------------------------------------
  if (step === 'pin') {
    return (
      <Step
        {...common('pin')}
        icon="shield-checkmark"
        tint={colors.goldDeep}
        title={hi ? 'एक PIN चुनिए' : 'Choose a PIN'}
        blurb={
          hi
            ? 'अगर कोई आपका फ़ोन छीन ले, तो बिना इस PIN के आपका SOS रोका नहीं जा सकता।'
            : 'If someone takes your phone, your SOS cannot be cancelled without this PIN.'
        }
        ctaLabel={hi ? 'हो गया' : 'Done'}
        ctaDisabled={pin.length !== 4}
        onBack={() => go('circle')}
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
  // Every line is live for her right now. Nothing aspirational, nothing she did
  // not do, because this is the screen the whole flow exists to make true.
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
  if (joined) lines.push(hi ? 'आप एक circle में हैं' : 'You are in a circle');

  return <Protected lines={lines} ctaLabel={hi ? 'ORBII खोलिए' : 'Enter ORBII'} onDone={onDone} />;
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
  invite: { letterSpacing: 3, textAlign: 'center', fontFamily: fontFamilies.poppinsSemiBold },

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

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  chipText: { fontFamily: fontFamilies.interRegular, fontSize: 14, color: colors.textSecondary },
  chipTextOn: { color: colors.textInverse, fontFamily: fontFamilies.poppinsSemiBold },

  joined: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  joinedText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.sageDeep },
});
