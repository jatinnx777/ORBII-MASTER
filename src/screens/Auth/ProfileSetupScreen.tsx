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
import { isValidName } from '@/utils/validation';

export function ProfileSetupScreen() {
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [name, setName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canSubmit = isValidName(name) && !isSaving;

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
    if (!canSubmit) {
      setError('Enter your full name (2–50 characters).');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateProfile(profile, {
        name,
        photoUri,
      });
      dispatch(profileUpdated(updated));
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
});
