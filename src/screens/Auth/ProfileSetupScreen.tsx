import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Button, Input, ScreenContainer } from '@/components/common';
import { colors, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { profileUpdated } from '@/redux/slices/userSlice';
import { updateProfile } from '@/services/auth';
import {
  formatPhoneForDisplay,
  isValidIndianPhone,
  isValidName,
  toE164India,
} from '@/utils/validation';

export function ProfileSetupScreen() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // 3-20 chars, lowercase letters/numbers/underscore. Friends look you up
  // by typing this exact string, so we keep the format strict.
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);
  const phoneDigits = phoneInput.replace(/\D/g, '').slice(0, 10);
  const phoneValid = isValidIndianPhone(phoneDigits);
  const canSubmit =
    isValidName(name) && usernameValid && phoneValid && !isSaving;

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

  const handleSubmit = async () => {
    if (!profile) {
      setError('Session expired. Please sign in again.');
      return;
    }
    if (!isValidName(name)) {
      setError('Enter your full name (2 to 50 characters).');
      return;
    }
    if (!usernameValid) {
      setError(
        'Username must be 3 to 20 lowercase letters, numbers, or underscores.',
      );
      return;
    }
    if (!phoneValid) {
      setError('Enter a valid 10-digit Indian mobile number.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
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

  const initial = name.trim().charAt(0).toUpperCase();

  return (
    <ScreenContainer scroll>
      <View style={styles.body}>
        <Text style={styles.title}>Set up your profile</Text>
        <Text style={styles.subtitle}>
          This helps helpers recognise you in an emergency.
        </Text>

        <View style={styles.avatarWrapper}>
          <Pressable
            onPress={pickPhoto}
            accessibilityRole="button"
            accessibilityLabel="Add profile photo"
            style={({ pressed }) => [
              styles.avatar,
              pressed && styles.avatarPressed,
            ]}
          >
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.avatarImage} />
            ) : initial ? (
              <Text style={styles.avatarInitial}>{initial}</Text>
            ) : (
              <Text style={styles.avatarPlaceholder}>Add photo</Text>
            )}
          </Pressable>
          <Pressable onPress={pickPhoto} hitSlop={12}>
            <Text style={styles.avatarAction}>
              {photoUri ? 'Change photo' : 'Upload photo'}
            </Text>
          </Pressable>
        </View>

        <Input
          label="Full name"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          value={name}
          onChangeText={(v) => {
            setName(v);
            if (error) setError(null);
          }}
          placeholder="e.g. Jatin Kumar"
          maxLength={50}
          containerStyle={styles.input}
        />

        <Input
          label="Username"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={(v) => {
            setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''));
            if (error) setError(null);
          }}
          placeholder="e.g. jatin_k"
          maxLength={20}
          hint="Friends will add you to their safety circle by this username."
          containerStyle={styles.input}
        />

        <Input
          label="Mobile number"
          keyboardType="number-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          maxLength={11}
          value={phoneInput}
          onChangeText={(v) => {
            const digits = v.replace(/\D/g, '').slice(0, 10);
            setPhoneInput(formatPhoneForDisplay(digits));
            if (error) setError(null);
          }}
          placeholder="98765 43210"
          leftAdornment={<Text style={styles.countryCode}>+91</Text>}
          hint="Required. Helpers and your contacts use this number to reach you in an emergency."
          error={error ?? undefined}
          containerStyle={styles.input}
        />

        <Button
          label="Continue"
          onPress={handleSubmit}
          loading={isSaving}
          disabled={!canSubmit}
          style={styles.submit}
        />

        <Text style={styles.helper}>
          You can add emergency contacts right after this.
        </Text>
      </View>
    </ScreenContainer>
  );
}

const AVATAR_SIZE = 112;

const styles = StyleSheet.create({
  body: {
    flex: 1,
    marginTop: spacing.xl,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  avatarWrapper: {
    alignItems: 'center',
    marginBottom: spacing.xl,
    gap: spacing.sm,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarPressed: {
    opacity: 0.8,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarInitial: {
    ...typography.h1,
    color: colors.primary,
  },
  avatarPlaceholder: {
    ...typography.label,
    color: colors.textMuted,
  },
  avatarAction: {
    ...typography.label,
    color: colors.primary,
  },
  input: {
    marginBottom: spacing.lg,
  },
  submit: {
    marginTop: spacing.sm,
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  countryCode: {
    ...typography.bodyMedium,
    color: colors.textPrimary,
  },
});
