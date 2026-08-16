import React, { useMemo, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Button, Input, Mascot, ScreenContainer } from '@/components/common';
import type { MascotPose } from '@/components/common/Mascot';
import {
  colors,
  fontFamilies,
  radius,
  shadows,
  spacing,
  typography,
} from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { contactAdded, profileUpdated } from '@/redux/slices/userSlice';
import { updateProfile } from '@/services/auth';
import { recordConsent, logConsentEvent } from '@/services/consent';
import { upsertEmergencyContact } from '@/services/emergency-contacts';
import { isUsernameAvailable } from '@/services/users-public';
import {
  formatPhoneForDisplay,
  isValidIndianPhone,
  isValidName,
  toE164India,
} from '@/utils/validation';

// Four-step Profile Setup wizard. Replaces the single-page form so a
// brand-new user lands on Home with:
//   • a real display name + username (others can find them)
//   • a profile photo (their circle recognises them in an emergency)
//   • a phone (pre-filled from OTP login when available)
//   • at least ONE emergency contact (the SOS button is otherwise a
//     no-op, which is the most common drop-off reason for safety apps)
//
// The wizard advances on Continue and saves only on the last step. If
// the user hits back from step 1 we keep them in AuthNavigator (no
// way out without finishing setup, same gate as before).

// The emergency contact used to be collected here AND again in guided setup's
// "Build Your Safety Circle". Asking twice made people think the first one
// hadn't saved. Guided setup owns it now (it also blocks using your own number).
type Step = 'identity' | 'photo' | 'phone';
const STEPS: Step[] = ['identity', 'photo', 'phone'];

export function ProfileSetupScreen() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [step, setStep] = useState<Step>('identity');
  const [name, setName] = useState(profile?.name ?? '');
  const [username, setUsername] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(profile?.photoUri ?? null);
  const [phoneInput, setPhoneInput] = useState(
    profile?.phone ? formatPhoneForDisplay(profile.phone.replace(/^\+91/, '')) : '',
  );
  const [phoneConfirm, setPhoneConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  // DPDP consent gate. Must be accepted (18+ and privacy notice) before the
  // user can enter any setup, so we never process data without a lawful basis.
  const [consented, setConsented] = useState(false);

  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);
  const phoneDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const phoneValid = isValidIndianPhone(phoneDigits);
  // Typed twice: this is the number an SOS dials, and it's locked once saved.
  const confirmDigits = phoneConfirm.replace(/\D/g, '').slice(0, 10);
  const phoneMismatch = confirmDigits.length === 10 && confirmDigits !== phoneDigits;
  const phoneConfirmed = phoneValid && confirmDigits === phoneDigits;

  const currentIndex = STEPS.indexOf(step);
  const progress = (currentIndex + 1) / STEPS.length;

  const stepReady = useMemo(() => {
    if (step === 'identity') return isValidName(name) && usernameValid;
    if (step === 'photo') return true; // photo is optional
    if (step === 'phone') return phoneConfirmed;
    return false;
  }, [step, name, usernameValid, phoneConfirmed]);

  const goNext = async () => {
    setError(null);
    if (step === 'identity') {
      setStep('photo');
      return;
    }
    if (step === 'photo') {
      setStep('phone');
      return;
    }
    if (step === 'phone') {
      // Second confirmation. This is the number helpers and your circle dial in
      // an emergency, and it cannot be changed afterwards, so make the user
      // look at it once more before it's locked.
      appAlert(
        'Confirm your number',
        `+91 ${formatPhoneForDisplay(phoneDigits)}\n\nThis is the number your circle and helpers will call in an emergency. It cannot be changed later.`,
        [
          { text: 'Edit', style: 'cancel' },
          { text: 'Yes, lock it', onPress: () => void submitAll() },
        ],
      );
      return;
    }
  };

  const goBack = () => {
    setError(null);
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  const pickPhoto = async () => {
    try {
      // Android system Photo Picker (and iOS picker), no media permission
      // needed, and complies with Google Play's Photo & Video Permissions policy.
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]?.uri) {
        setPhotoUri(result.assets[0].uri);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not open photo picker.';
      appAlert('Something went wrong', message);
    }
  };

  const submitAll = async () => {
    if (!profile) {
      setError('Session expired. Please sign in again.');
      return;
    }
    if (!stepReady) return;
    setIsSaving(true);
    setError(null);
    try {
      const available = await isUsernameAvailable(username, profile.uid);
      if (!available) {
        setError(`@${username} is already taken. Pick another.`);
        setIsSaving(false);
        setStep('identity');
        return;
      }
      const updated = await updateProfile(profile, {
        name,
        photoUri,
        username,
      });
      const now = Date.now();
      dispatch(
        profileUpdated({
          ...updated,
          phone: toE164India(phoneDigits),
          usernameChangedAt: now,
          photoChangedAt: photoUri ? now : null,
        }),
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not save profile.';
      setError(message);
      setIsSaving(false);
    }
  };

  if (!consented) {
    return (
      <ScreenContainer scroll>
        <ConsentGate
          onAccept={async (isAdult) => {
            await recordConsent('en', isAdult);
            // Evidence trail: what was agreed, when, against which notice.
            void logConsentEvent('core', true, { method: 'checkbox' });
            setConsented(true);
          }}
        />
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer scroll>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          <ProgressDots index={currentIndex} total={STEPS.length} />

          {step === 'identity' ? (
            <IdentityStep
              name={name}
              username={username}
              error={error}
              onName={(v) => {
                setName(v);
                if (error) setError(null);
              }}
              onUsername={(v) => {
                setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
                if (error) setError(null);
              }}
            />
          ) : null}

          {step === 'photo' ? (
            <PhotoStep
              name={name}
              photoUri={photoUri}
              onPick={pickPhoto}
              onSkip={() => setPhotoUri(null)}
            />
          ) : null}

          {step === 'phone' ? (
            <PhoneStep
              value={phoneInput}
              confirmValue={phoneConfirm}
              mismatch={phoneMismatch}
              error={error}
              onChange={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 10);
                setPhoneInput(formatPhoneForDisplay(digits));
                if (error) setError(null);
              }}
              onChangeConfirm={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 10);
                setPhoneConfirm(formatPhoneForDisplay(digits));
              }}
            />
          ) : null}


          <View style={styles.footer}>
            <Button
              label={step === 'phone' ? 'Finish setup' : 'Continue'}
              onPress={goNext}
              loading={isSaving}
              disabled={!stepReady}
            />
            <View style={styles.footerRow}>
              {currentIndex > 0 ? (
                <Pressable onPress={goBack} hitSlop={8}>
                  <Text style={styles.linkText}>← Back</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Text style={styles.muted}>
                Step {currentIndex + 1} of {STEPS.length}
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

// DPDP Act 2023, Section 5/6, a clear, itemised notice with a free, specific,
// unambiguous, *unticked* opt-in. Both boxes must be checked to continue, and we
// log the consent (version + language + 18+) before any setup begins.
// Age of majority under the DPDP Act. Anyone below it is a "child", and the
// Rules forbid tracking, monitoring or profiling them without verifiable
// parental consent, so ORBII must know a real date, not a tick-box.
function ageFrom(d: number, m: number, y: number): number | null {
  if (!d || !m || !y || y < 1900) return null;
  const dob = new Date(y, m - 1, d);
  if (dob.getDate() !== d || dob.getMonth() !== m - 1) return null; // 31 Feb etc
  const now = new Date();
  let age = now.getFullYear() - y;
  const beforeBirthday =
    now.getMonth() < m - 1 || (now.getMonth() === m - 1 && now.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

function ConsentGate({ onAccept }: { onAccept: (isAdult: boolean) => Promise<void> }) {
  const [dob, setDob] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const digits = dob.replace(/\D/g, '').slice(0, 8);
  const age = ageFrom(
    Number(digits.slice(0, 2)),
    Number(digits.slice(2, 4)),
    Number(digits.slice(4, 8)),
  );
  const dobComplete = digits.length === 8 && age !== null && age >= 0 && age < 120;
  const adult = dobComplete && (age as number) >= 18;
  const ready = dobComplete && agree;

  const points: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
    { icon: 'mic-off-outline', text: 'Your voice is checked only on your phone. Audio leaves your device only if you choose to donate a clip to help train ORBII, which is optional and off by default.' },
    { icon: 'location-outline', text: 'Location is shared only when you turn it on, and only with the circle you choose. You can pause it any time.' },
    { icon: 'time-outline', text: 'Location history is auto-deleted after 48 hours.' },
    { icon: 'lock-closed-outline', text: 'We never sell your data, and never give it to your college or any third party.' },
  ];

  return (
    <View style={styles.body}>
      <View style={styles.titleBlock}>
        <Mascot pose="wave" size={110} style={styles.stepMascot} />
        <Text style={styles.eyebrow}>BEFORE WE BEGIN</Text>
        <Text style={styles.h1}>Your privacy, in plain words</Text>
        <Text style={styles.sub}>
          ORBII is built to protect you. Here is exactly what we do with your data.
        </Text>
      </View>

      <View style={styles.consentCard}>
        {points.map((p) => (
          <View key={p.text} style={styles.consentPoint}>
            <Ionicons name={p.icon} size={18} color={colors.brandDeep} style={{ marginTop: 1 }} />
            <Text style={styles.consentPointText}>{p.text}</Text>
          </View>
        ))}
      </View>

      <View style={styles.dobBlock}>
        <Text style={styles.dobLabel}>Your date of birth</Text>
        <Input
          value={dob}
          onChangeText={(v: string) => {
            const d = v.replace(/\D/g, '').slice(0, 8);
            setDob(
              d.length > 4 ? `${d.slice(0,2)}/${d.slice(2,4)}/${d.slice(4)}`
              : d.length > 2 ? `${d.slice(0,2)}/${d.slice(2)}`
              : d,
            );
          }}
          placeholder="DD / MM / YYYY"
          keyboardType="number-pad"
        />
        {dobComplete ? (
          <Text style={[styles.dobNote, !adult && styles.dobNoteWarn]}>
            {adult
              ? 'Thanks. Everything in ORBII is available to you.'
              : "You're under 18, so ORBII will protect you but will never track your location or share it with a circle. That's the law, and we think it's right."}
          </Text>
        ) : (
          <Text style={styles.dobNote}>
            We ask because Indian law treats under-18s differently, and we will not track a minor's location.
          </Text>
        )}
      </View>
      <ConsentCheck
        checked={agree}
        onToggle={() => setAgree((v) => !v)}
        label="I have read and agree to the Privacy Policy and Terms."
        linkLabel="Read the Privacy Policy"
        onLink={() => Linking.openURL('https://orbii.in/privacy-policy').catch(() => undefined)}
      />

      <View style={styles.footer}>
        <Button
          label="Agree & continue"
          disabled={!ready || busy}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            try {
              await onAccept(adult);
            } finally {
              setBusy(false);
            }
          }}
        />
        <Text style={[styles.muted, { textAlign: 'center' }]}>
          You can delete all your data any time from Settings.
        </Text>
      </View>
    </View>
  );
}

function ConsentCheck({
  checked,
  onToggle,
  label,
  linkLabel,
  onLink,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  linkLabel?: string;
  onLink?: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      style={styles.checkRow}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
        {checked ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {linkLabel ? (
          <Pressable onPress={onLink} hitSlop={8}>
            <Text style={styles.linkText}>{linkLabel}</Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

function ProgressDots({ index, total }: { index: number; total: number }) {
  const fade = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.timing(fade, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [index, fade]);
  return (
    <View style={styles.dotsRow}>
      {Array.from({ length: total }).map((_, i) => {
        const done = i <= index;
        return (
          <View
            key={i}
            style={[
              styles.progressDot,
              done && styles.progressDotDone,
              i === index && styles.progressDotActive,
            ]}
          />
        );
      })}
    </View>
  );
}

function StepTitle({
  eyebrow,
  title,
  subtitle,
  mascot,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  mascot?: MascotPose;
}) {
  return (
    <View style={styles.titleBlock}>
      {mascot ? <Mascot pose={mascot} size={110} style={styles.stepMascot} /> : null}
      <Text style={styles.eyebrow}>{eyebrow}</Text>
      <Text style={styles.h1}>{title}</Text>
      <Text style={styles.sub}>{subtitle}</Text>
    </View>
  );
}

function IdentityStep({
  name,
  username,
  error,
  onName,
  onUsername,
}: {
  name: string;
  username: string;
  error: string | null;
  onName: (v: string) => void;
  onUsername: (v: string) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <StepTitle
        mascot="wave"
        eyebrow="STEP 1 OF 3"
        title="What should we call you?"
        subtitle="This is what your circle and helpers see when you fire an SOS."
      />
      <Input
        label="Full name"
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        value={name}
        onChangeText={onName}
        placeholder="e.g. Priya Sharma"
        maxLength={50}
        containerStyle={styles.input}
      />
      <Input
        label="Username"
        autoCapitalize="none"
        autoCorrect={false}
        value={username}
        onChangeText={onUsername}
        placeholder="e.g. priya_s"
        maxLength={20}
        hint="3 to 20 lowercase letters, numbers, or underscores. Friends find you by this."
        error={error ?? undefined}
        containerStyle={styles.input}
      />
    </View>
  );
}

function PhotoStep({
  name,
  photoUri,
  onPick,
  onSkip,
}: {
  name: string;
  photoUri: string | null;
  onPick: () => void;
  onSkip: () => void;
}) {
  const initial = name.trim().charAt(0).toUpperCase() || 'O';
  return (
    <View style={styles.stepBody}>
      <StepTitle
        mascot="neutral"
        eyebrow="STEP 2 OF 3"
        title="Add a photo"
        subtitle="Helpers responding to your SOS can recognise you faster. Optional, but recommended."
      />
      <View style={styles.avatarWrap}>
        <Pressable
          onPress={onPick}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
        >
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </Pressable>
        <Pressable onPress={onPick} hitSlop={12}>
          <Text style={styles.linkText}>
            {photoUri ? 'Change photo' : 'Choose from photos'}
          </Text>
        </Pressable>
        {photoUri ? (
          <Pressable onPress={onSkip} hitSlop={12}>
            <Text style={styles.muted}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function PhoneStep({
  value,
  confirmValue,
  mismatch,
  error,
  onChange,
  onChangeConfirm,
}: {
  value: string;
  confirmValue: string;
  mismatch: boolean;
  error: string | null;
  onChange: (v: string) => void;
  onChangeConfirm: (v: string) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <StepTitle
        mascot="headset"
        eyebrow="STEP 3 OF 3"
        title="Your phone number"
        subtitle="Helpers and your emergency contacts use this to reach you."
      />

      <View style={styles.lockNotice}>
        <Ionicons name="lock-closed" size={16} color={colors.coralDeep} />
        <Text style={styles.lockText}>
          This number <Text style={styles.lockBold}>cannot be changed later</Text>.
          It's what your circle and helpers dial in an emergency, so enter it
          carefully.
        </Text>
      </View>

      <Input
        label="Mobile number"
        keyboardType="number-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        maxLength={11}
        value={value}
        onChangeText={onChange}
        placeholder="98765 43210"
        leftAdornment={<Text style={styles.countryCode}>+91</Text>}
        error={error ?? undefined}
        containerStyle={styles.input}
      />
      <Input
        label="Re-enter mobile number"
        keyboardType="number-pad"
        maxLength={11}
        value={confirmValue}
        onChangeText={onChangeConfirm}
        placeholder="98765 43210"
        leftAdornment={<Text style={styles.countryCode}>+91</Text>}
        error={mismatch ? "Numbers don't match. Check both carefully." : undefined}
        containerStyle={styles.input}
      />
    </View>
  );
}

const AVATAR_SIZE = 128;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: spacing.xl,
  },
  progressDot: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressDotDone: {
    backgroundColor: colors.peach,
  },
  progressDotActive: {
    backgroundColor: colors.peachDeep,
  },
  titleBlock: {
    marginBottom: spacing.lg,
    alignItems: 'center',
  },
  dobBlock: { marginBottom: spacing.md, gap: spacing.xs },
  dobLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary },
  dobNote: { ...typography.caption, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
  dobNoteWarn: { color: colors.brandDeep, fontFamily: fontFamilies.interMedium },
  stepMascot: {
    marginBottom: spacing.sm,
  },
  eyebrow: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.peachDeep,
    letterSpacing: 0.1,
    marginBottom: spacing.xs,
  },
  h1: {
    ...typography.h1,
    color: colors.textPrimary,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  sub: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  stepBody: {
    minHeight: 380,
  },
  input: {
    marginBottom: spacing.lg,
  },
  avatarWrap: {
    alignItems: 'center',
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.brandSoft,
    borderWidth: 2,
    borderColor: colors.brandMid,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadows.card,
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    ...typography.h1,
    color: colors.brandDeep,
  },
  linkText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 13.5,
    color: colors.brandDeep,
  },
  muted: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12.5,
    color: colors.textMuted,
  },
  countryCode: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
  lockNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.coralSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  lockText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  lockBold: { fontFamily: fontFamilies.poppinsBold },
  relationLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 12,
    color: colors.textSecondary,
    letterSpacing: 0.4,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  relationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  relationChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radius.circle,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  relationChipActive: {
    backgroundColor: colors.peach,
    borderColor: colors.peachDeep,
  },
  relationChipText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  relationChipTextActive: {
    color: colors.textPrimary,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
  },
  errorText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.error,
  },
  consentCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  consentPoint: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  consentPointText: {
    flex: 1,
    fontFamily: fontFamilies.interMedium,
    fontSize: 13,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  checkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginBottom: spacing.md,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.brandMid,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: {
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  checkLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 13.5,
    lineHeight: 19,
    color: colors.textPrimary,
  },
  footer: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
