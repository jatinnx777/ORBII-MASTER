import React, { useMemo, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Button, Input, ScreenContainer } from '@/components/common';
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
// way out without finishing setup — same gate as before).

type Step = 'identity' | 'photo' | 'phone' | 'contact';
const STEPS: Step[] = ['identity', 'photo', 'phone', 'contact'];

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
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactRelation, setContactRelation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);
  const phoneDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const phoneValid = isValidIndianPhone(phoneDigits);
  const contactPhoneDigits = contactPhone.replace(/\D/g, '').slice(0, 10);
  const contactPhoneValid = isValidIndianPhone(contactPhoneDigits);

  const currentIndex = STEPS.indexOf(step);
  const progress = (currentIndex + 1) / STEPS.length;

  const stepReady = useMemo(() => {
    if (step === 'identity') return isValidName(name) && usernameValid;
    if (step === 'photo') return true; // photo is optional
    if (step === 'phone') return phoneValid;
    if (step === 'contact') {
      return (
        isValidName(contactName) && contactPhoneValid && !!contactRelation.trim()
      );
    }
    return false;
  }, [step, name, usernameValid, phoneValid, contactName, contactPhoneValid, contactRelation]);

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
      setStep('contact');
      return;
    }
    // step === 'contact' → save everything
    await submitAll();
  };

  const goBack = () => {
    setError(null);
    const i = STEPS.indexOf(step);
    if (i > 0) setStep(STEPS[i - 1]);
  };

  const pickPhoto = async () => {
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          'Permission needed',
          'Allow photo access to set a profile picture.',
        );
        return;
      }
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
      Alert.alert('Something went wrong', message);
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
      // Add the first emergency contact alongside the profile save.
      // We do this BEFORE dispatching profileUpdated so the user lands
      // on Home with their contact already in state.
      const newContact = {
        id: `ec_${Date.now()}_${Math.floor(Math.random() * 1e6)}`,
        name: contactName.trim(),
        phone: toE164India(contactPhoneDigits),
        relation: contactRelation.trim(),
      };
      await upsertEmergencyContact(profile.uid, newContact).catch(() => undefined);
      dispatch(contactAdded(newContact));
      dispatch(
        profileUpdated({
          ...updated,
          phone: toE164India(phoneDigits),
          emergencyContacts: [...(updated.emergencyContacts ?? []), newContact],
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
              error={error}
              onChange={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 10);
                setPhoneInput(formatPhoneForDisplay(digits));
                if (error) setError(null);
              }}
            />
          ) : null}

          {step === 'contact' ? (
            <ContactStep
              name={contactName}
              phone={contactPhone}
              relation={contactRelation}
              error={error}
              onName={(v) => {
                setContactName(v);
                if (error) setError(null);
              }}
              onPhone={(v) => {
                const digits = v.replace(/\D/g, '').slice(0, 10);
                setContactPhone(formatPhoneForDisplay(digits));
                if (error) setError(null);
              }}
              onRelation={(v) => {
                setContactRelation(v);
                if (error) setError(null);
              }}
            />
          ) : null}

          <View style={styles.footer}>
            <Button
              label={step === 'contact' ? 'Finish setup' : 'Continue'}
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

function StepTitle({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <View style={styles.titleBlock}>
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
        eyebrow="STEP 1 OF 4"
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
        eyebrow="STEP 2 OF 4"
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
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.stepBody}>
      <StepTitle
        eyebrow="STEP 3 OF 4"
        title="Your phone number"
        subtitle="Helpers and your emergency contacts use this to reach you."
      />
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
    </View>
  );
}

function ContactStep({
  name,
  phone,
  relation,
  error,
  onName,
  onPhone,
  onRelation,
}: {
  name: string;
  phone: string;
  relation: string;
  error: string | null;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
  onRelation: (v: string) => void;
}) {
  const RELATIONS = ['Mother', 'Father', 'Sibling', 'Partner', 'Friend', 'Other'];
  return (
    <View style={styles.stepBody}>
      <StepTitle
        eyebrow="STEP 4 OF 4"
        title="Your first emergency contact"
        subtitle="The person who gets a WhatsApp ping the moment you fire SOS. You can add more later."
      />
      <Input
        label="Their name"
        autoCapitalize="words"
        value={name}
        onChangeText={onName}
        placeholder="e.g. Mom"
        maxLength={50}
        containerStyle={styles.input}
      />
      <Input
        label="Their phone number"
        keyboardType="number-pad"
        maxLength={11}
        value={phone}
        onChangeText={onPhone}
        placeholder="98765 43210"
        leftAdornment={<Text style={styles.countryCode}>+91</Text>}
        containerStyle={styles.input}
      />
      <Text style={styles.relationLabel}>Relation</Text>
      <View style={styles.relationGrid}>
        {RELATIONS.map((r) => {
          const active = r === relation;
          return (
            <Pressable
              key={r}
              onPress={() => onRelation(r)}
              style={[styles.relationChip, active && styles.relationChipActive]}
              accessibilityRole="button"
            >
              <Text
                style={[
                  styles.relationChipText,
                  active && styles.relationChipTextActive,
                ]}
              >
                {r}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={14} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
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
    backgroundColor: colors.brandMid,
  },
  progressDotActive: {
    backgroundColor: colors.brandDeep,
  },
  titleBlock: {
    marginBottom: spacing.lg,
  },
  eyebrow: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    color: colors.brandDeep,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  h1: {
    ...typography.h2,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  sub: {
    ...typography.body,
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 20,
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
    backgroundColor: colors.brandDeep,
    borderColor: colors.brandDeep,
  },
  relationChipText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12.5,
    color: colors.textPrimary,
  },
  relationChipTextActive: {
    color: colors.textInverse,
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
