import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { colors, radius, spacing, typography } from '@/theme';
import { GuidedStage } from '@/components/onboarding/GuidedStage';
import { remoteVideoFor, videoFor, type OnboardingLang } from '@/onboardingVideos';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { profileUpdated, signInSucceeded } from '@/redux/slices/userSlice';
import { historyHydrated } from '@/redux/slices/historySlice';
import {
  sendEmailOtp,
  signInWithGoogle,
  updateProfile,
  verifyEmailOtp,
} from '@/services/auth';
import { isUsernameAvailable } from '@/services/users-public';
import { bindReferral, checkCode, normaliseCode, setStoredCode } from '@/services/referral';
import { recordConsent, logConsentEvent } from '@/services/consent';
import { toE164India } from '@/utils/validation';

/**
 * One flow, from language to a working account.
 *
 * This replaces WelcomeScreen, PhoneVerifyScreen and ProfileSetupScreen with a
 * single guided sequence in one visual language. It reuses their SERVICES
 * unchanged rather than reimplementing them, because the things those screens
 * carry are not cosmetic:
 *
 *   • the DPDP consent record and the age gate
 *   • the campus referral binding
 *   • username availability, which is enforced server-side too
 *
 * Losing any of those to a redesign would be a real regression, so each one is
 * called here exactly as it was called there.
 *
 * ORDERING, and why it is not the usual one. Consent comes before sign-in, not
 * after. She is being told what happens to her voice and her location BEFORE
 * she hands over an email, which is the only order that makes the promise mean
 * anything.
 *
 * SKIP IS NOT A COURTESY. She may be installing ORBII because she feels unsafe
 * right now. Every step after consent can be skipped, and skipping lands her in
 * an app that still works. Do not remove it to improve completion.
 */

type Step = 'consent' | 'signin' | 'code' | 'name' | 'photo' | 'phone';
const STEPS: Step[] = ['consent', 'signin', 'code', 'name', 'photo', 'phone'];

function ageFrom(d: number, m: number, y: number): number | null {
  if (!d || !m || !y || y < 1900) return null;
  const dob = new Date(y, m - 1, d);
  if (dob.getDate() !== d || dob.getMonth() !== m - 1) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  const before =
    now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d);
  if (before) age -= 1;
  return age;
}

export function OnboardingFlow({ lang, onDone }: { lang: OnboardingLang; onDone: () => void }) {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const hi = lang === 'hi';

  const [step, setStep] = useState<Step>('consent');
  const [busy, setBusy] = useState(false);

  // consent
  const [dob, setDob] = useState('');
  const [agree, setAgree] = useState(false);

  // auth
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  // profile
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [refCode, setRefCode] = useState('');
  const [refCollege, setRefCollege] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [phoneDigits, setPhoneDigits] = useState('');

  const i = STEPS.indexOf(step);
  const go = (s: Step) => setStep(s);
  const back = () => (i > 0 ? setStep(STEPS[i - 1]) : undefined);

  const src = (key: Parameters<typeof videoFor>[0]) =>
    videoFor(key, lang) ?? remoteVideoFor(key, lang);

  const digits = dob.replace(/\D/g, '').slice(0, 8);
  const age = ageFrom(Number(digits.slice(0, 2)), Number(digits.slice(2, 4)), Number(digits.slice(4, 8)));
  const dobOk = digits.length === 8 && age !== null && age >= 0 && age < 120;
  const adult = dobOk && (age as number) >= 18;

  const common = {
    index: i,
    total: STEPS.length,
    onBack: i > 0 ? back : undefined,
  };

  // Skip is only offered AFTER she has an account, and that is not a UX
  // preference. Before sign-in there is nothing to skip TO: no circle, no
  // contacts, no profile to alert anyone with. Offering it on the consent or
  // sign-in step would drop her back onto the same screen forever, because the
  // app has no signed-in state to fall through to.
  //
  // On the steps below it works, because she is already authenticated and the
  // root navigator moves her into the app the moment onDone fires.
  const skip = {
    onSkip: onDone,
    skipLabel: hi ? 'छोड़िए, अभी चाहिए' : 'Skip, I need this now',
  };

  // ---- consent -----------------------------------------------------------
  // Deliberately NOT skippable. Everything else here is.
  if (step === 'consent') {
    return (
      <GuidedStage
        {...common}
        title={hi ? 'शुरू करने से पहले' : 'Before we begin'}
        sheetTitle={hi ? 'आपकी privacy, सीधे शब्दों में' : 'YOUR PRIVACY, IN PLAIN WORDS'}
        video={null}
        nextLabel={hi ? 'सहमत हूँ, आगे बढ़ें' : 'Agree and continue'}
        nextDisabled={!dobOk || !agree || busy}
        onNext={async () => {
          setBusy(true);
          try {
            await recordConsent(lang, adult);
            void logConsentEvent('core', true, { method: 'checkbox' });
            go('signin');
          } finally {
            setBusy(false);
          }
        }}
      >
        <Text style={s.point}>
          {hi
            ? 'आपकी आवाज़ सिर्फ़ आपके फ़ोन पर जाँची जाती है। Audio फ़ोन से बाहर तभी जाता है जब आप खुद चुनें।'
            : 'Your voice is checked only on your phone. Audio leaves your device only if you choose.'}
        </Text>
        <Text style={s.point}>
          {hi
            ? 'Location तभी share होती है जब आप चालू करें, और सिर्फ़ आपके चुने circle से।'
            : 'Location is shared only when you turn it on, and only with the circle you choose.'}
        </Text>
        <Text style={s.point}>
          {hi
            ? 'आपकी location history हर रात मिटा दी जाती है।'
            : 'Your location history is deleted every night.'}
        </Text>
        <Text style={s.point}>
          {hi
            ? 'हम आपका data कभी नहीं बेचते, ना college को, ना किसी और को।'
            : 'We never sell your data. Not to your college, not to anyone.'}
        </Text>

        <Text style={s.label}>{hi ? 'आपकी जन्म तिथि' : 'Your date of birth'}</Text>
        <TextInput
          value={dob}
          onChangeText={(v) => {
            const d = v.replace(/\D/g, '').slice(0, 8);
            setDob(
              d.length > 4
                ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`
                : d.length > 2
                  ? `${d.slice(0, 2)}/${d.slice(2)}`
                  : d,
            );
          }}
          placeholder="DD / MM / YYYY"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          style={s.input}
        />
        {dobOk && !adult ? (
          <Text style={s.warn}>
            {hi
              ? 'आप 18 से कम हैं, तो ORBII आपकी रक्षा करेगा पर आपकी location कभी track या share नहीं करेगा। यही क़ानून है, और हमें यह सही लगता है।'
              : "You're under 18, so ORBII will protect you but will never track or share your location. That's the law, and we think it's right."}
          </Text>
        ) : null}

        <Pressable style={s.check} onPress={() => setAgree((v) => !v)}>
          <View style={[s.box, agree && s.boxOn]} />
          <Text style={s.checkText}>
            {hi
              ? 'मैंने Privacy Policy और Terms पढ़ लिए हैं और सहमत हूँ।'
              : 'I have read and agree to the Privacy Policy and Terms.'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => Linking.openURL('https://www.orbii.in/privacy-policy').catch(() => undefined)}
        >
          <Text style={s.link}>{hi ? 'Privacy Policy पढ़िए' : 'Read the Privacy Policy'}</Text>
        </Pressable>
      </GuidedStage>
    );
  }

  // ---- sign in -----------------------------------------------------------
  if (step === 'signin') {
    return (
      <GuidedStage
        {...common}
        title={hi ? 'Account बनाइए' : 'Create your account'}
        sheetTitle={hi ? 'साइन इन' : 'SIGN IN'}
        video={src('signin')}
      >
        <Pressable
          style={s.primaryRow}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            try {
              const r = await signInWithGoogle();
              dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
              dispatch(historyHydrated(r.history));
              setName(r.profile.name ?? '');
              if (r.needsProfile) go('name');
              else onDone();
            } catch (err) {
              const m = err instanceof Error ? err.message : 'Google sign-in failed.';
              if (!/cancel/i.test(m)) Alert.alert("Couldn't sign in", m);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Text style={s.primaryText}>
            {hi ? 'Google से जारी रखें' : 'Continue with Google'}
          </Text>
        </Pressable>

        <Text style={s.or}>{hi ? 'या email से' : 'or with email'}</Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="you@email.com"
          placeholderTextColor={colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={s.input}
        />
        <Pressable
          style={[s.secondaryRow, (!/^\S+@\S+\.\S+$/.test(email) || busy) && s.rowOff]}
          disabled={!/^\S+@\S+\.\S+$/.test(email) || busy}
          onPress={async () => {
            setBusy(true);
            try {
              // Bounded on the service side: a slow SMTP handoff must not leave
              // her on a spinner. See WelcomeScreen's note, same reasoning.
              await sendEmailOtp(email);
            } catch {
              // A genuinely bad address surfaces on the code screen instead.
            } finally {
              setBusy(false);
              go('code');
            }
          }}
        >
          <Text style={s.secondaryText}>{hi ? 'Code भेजिए' : 'Email me a code'}</Text>
        </Pressable>
      </GuidedStage>
    );
  }

  // ---- code --------------------------------------------------------------
  if (step === 'code') {
    return (
      <GuidedStage
        {...common}
        title={hi ? 'Email देखिए' : 'Check your email'}
        sheetTitle={email.trim().toLowerCase()}
        video={null}
        nextLabel={hi ? 'आगे' : 'Continue'}
        nextDisabled={code.replace(/\D/g, '').length < 6 || busy}
        onNext={async () => {
          setBusy(true);
          try {
            const r = await verifyEmailOtp(email, code);
            dispatch(signInSucceeded({ profile: r.profile, needsProfile: r.needsProfile }));
            dispatch(historyHydrated(r.history));
            setName(r.profile.name ?? '');
            if (r.needsProfile) go('name');
            else onDone();
          } catch (err) {
            Alert.alert(
              hi ? 'Code ग़लत है' : "That code didn't work",
              err instanceof Error ? err.message : 'Try again.',
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextInput
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 8))}
          placeholder="000000"
          placeholderTextColor={colors.textMuted}
          keyboardType="number-pad"
          style={[s.input, s.code]}
        />
        <Text style={s.help}>
          {hi
            ? 'Code आने में एक मिनट लग सकता है। Spam folder भी देख लीजिए।'
            : 'The code can take a minute. Check your spam folder too.'}
        </Text>
      </GuidedStage>
    );
  }

  // ---- name --------------------------------------------------------------
  if (step === 'name') {
    return (
      <GuidedStage
        {...common}
        {...skip}
        title={hi ? 'आपका नाम' : 'Your name'}
        sheetTitle={hi ? 'आपका circle यही देखेगा' : 'THIS IS WHAT YOUR CIRCLE SEES'}
        video={src('name')}
        nextDisabled={name.trim().length < 2 || username.trim().length < 3 || busy}
        onNext={async () => {
          if (!profile) return;
          setBusy(true);
          try {
            const free = await isUsernameAvailable(username, profile.uid);
            if (!free) {
              Alert.alert(hi ? 'यह username लिया जा चुका है' : 'That username is taken');
              return;
            }
            go('photo');
          } finally {
            setBusy(false);
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
          value={username}
          onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
          placeholder={hi ? 'username' : 'username'}
          placeholderTextColor={colors.textMuted}
          style={s.input}
          autoCapitalize="none"
        />

        {/* The campus referral code. Kept exactly as ProfileSetupScreen had it,
            including storing it as she types, because bindReferral falls back
            to the stored value if the call at save time never lands. */}
        <TextInput
          value={refCode}
          onChangeText={(v) => {
            const up = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
            setRefCode(up);
            setRefCollege(null);
            void setStoredCode(up);
            if (normaliseCode(up)) {
              void checkCode(up)
                .then((c) => {
                  if (c.valid) setRefCollege(c.college ?? null);
                })
                .catch(() => undefined);
            }
          }}
          placeholder={hi ? 'Campus ambassador code (optional)' : 'Campus ambassador code (optional)'}
          placeholderTextColor={colors.textMuted}
          style={s.input}
          autoCapitalize="characters"
        />
        {refCollege ? <Text style={s.ok}>{refCollege}</Text> : null}
      </GuidedStage>
    );
  }

  // ---- photo -------------------------------------------------------------
  if (step === 'photo') {
    return (
      <GuidedStage
        {...common}
        {...skip}
        title={hi ? 'आपकी photo' : 'Your photo'}
        sheetTitle={hi ? 'ज़रूरी नहीं है' : 'OPTIONAL'}
        video={null}
        nextLabel={photoUri ? (hi ? 'आगे' : 'Continue') : hi ? 'बाद में' : 'Later'}
        onNext={() => go('phone')}
      >
        {photoUri ? <Image source={{ uri: photoUri }} style={s.avatar} /> : null}
        <Pressable
          style={s.secondaryRow}
          onPress={async () => {
            try {
              const r = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.7,
              });
              if (!r.canceled && r.assets[0]?.uri) setPhotoUri(r.assets[0].uri);
            } catch {
              // Picker unavailable. A photo is optional, so this is not an error.
            }
          }}
        >
          <Text style={s.secondaryText}>
            {photoUri ? (hi ? 'बदलिए' : 'Change') : hi ? 'Photo चुनिए' : 'Choose a photo'}
          </Text>
        </Pressable>
        <Text style={s.help}>
          {hi
            ? 'यह वही है जो आपके circle को alert में दिखता है।'
            : 'This is what your circle sees on an alert.'}
        </Text>
      </GuidedStage>
    );
  }

  // ---- phone, and the save ------------------------------------------------
  return (
    <GuidedStage
      {...common}
      {...skip}
      title={hi ? 'आपका number' : 'Your number'}
      sheetTitle={hi ? 'ताकि आपका circle आपको पहचाने' : 'SO YOUR CIRCLE KNOWS IT IS YOU'}
      video={null}
      nextLabel={hi ? 'हो गया' : 'Finish'}
      nextDisabled={phoneDigits.length !== 10 || busy}
      onNext={async () => {
        if (!profile) return;
        setBusy(true);
        try {
          const updated = await updateProfile(profile, { name, photoUri, username });
          const now = Date.now();
          dispatch(
            profileUpdated({
              ...updated,
              phone: toE164India(phoneDigits),
              usernameChangedAt: now,
              photoChangedAt: photoUri ? now : null,
            }),
          );

          // Not awaited, and guarded. An attribution must never sit between a
          // woman and the end of setup, and App.tsx retries a bind that never
          // landed, so a failure here costs nothing.
          void bindReferral(refCode || undefined).catch(() => undefined);
          onDone();
        } catch (err) {
          Alert.alert(
            hi ? 'सेव नहीं हो पाया' : 'Could not save',
            err instanceof Error ? err.message : 'Try again.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextInput
        value={phoneDigits}
        onChangeText={(v) => setPhoneDigits(v.replace(/\D/g, '').slice(0, 10))}
        placeholder="10 digit mobile number"
        placeholderTextColor={colors.textMuted}
        keyboardType="number-pad"
        style={s.input}
      />
    </GuidedStage>
  );
}

const s = StyleSheet.create({
  point: { ...typography.body, color: colors.textSecondary, lineHeight: 21 },
  label: { ...typography.caption, color: colors.textMuted, marginTop: spacing.xs },
  input: {
    height: 50,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  code: { letterSpacing: 6, textAlign: 'center', fontSize: 22 },
  warn: { ...typography.caption, color: colors.coralDeep, lineHeight: 18 },
  help: { ...typography.caption, color: colors.textMuted, lineHeight: 18 },
  ok: { ...typography.caption, color: colors.sageDeep, fontWeight: '700' },
  link: { ...typography.caption, color: colors.brandDeep, fontWeight: '700' },
  check: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    marginTop: 1,
  },
  boxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkText: { ...typography.caption, color: colors.textSecondary, flex: 1, lineHeight: 18 },
  primaryRow: {
    height: 52,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brand,
  },
  primaryText: { ...typography.button, color: colors.textInverse },
  secondaryRow: {
    height: 50,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  secondaryText: { ...typography.button, color: colors.textPrimary },
  rowOff: { opacity: 0.5 },
  or: { ...typography.caption, color: colors.textMuted, textAlign: 'center' },
  avatar: { width: 96, height: 96, borderRadius: 999, alignSelf: 'center' },
});
