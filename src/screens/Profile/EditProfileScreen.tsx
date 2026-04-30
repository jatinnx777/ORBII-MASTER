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
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Input, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { profileUpdated } from '@/redux/slices/userSlice';
import { isValidName } from '@/utils/validation';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'EditProfile'>;

export function EditProfileScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [name, setName] = useState(profile?.name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [photoUri, setPhotoUri] = useState(profile?.photoUri ?? null);

  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', 'Enable photo access to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = () => {
    if (!profile) return;
    if (!isValidName(name)) {
      Alert.alert('Name required', 'Please enter a valid name.');
      return;
    }
    if (!usernameValid) {
      Alert.alert(
        'Username invalid',
        'Username must be 3 to 20 lowercase letters, numbers, or underscores.',
      );
      return;
    }

    const now = Date.now();
    const COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
    const usernameChanged = username !== (profile.username ?? '');
    const photoChanged = photoUri !== (profile.photoUri ?? null);

    if (usernameChanged && profile.usernameChangedAt) {
      const remaining = profile.usernameChangedAt + COOLDOWN_MS - now;
      if (remaining > 0) {
        Alert.alert(
          'Username locked',
          `You can change your username again in ${formatDays(remaining)}.`,
        );
        return;
      }
    }
    if (photoChanged && profile.photoChangedAt) {
      const remaining = profile.photoChangedAt + COOLDOWN_MS - now;
      if (remaining > 0) {
        Alert.alert(
          'Photo locked',
          `You can change your profile photo again in ${formatDays(remaining)}.`,
        );
        return;
      }
    }

    dispatch(
      profileUpdated({
        ...profile,
        name: name.trim(),
        username,
        photoUri,
        usernameChangedAt: usernameChanged ? now : profile.usernameChangedAt,
        photoChangedAt: photoChanged ? now : profile.photoChangedAt,
      }),
    );
    navigation.goBack();
  };

  // Friendly remaining-days string for the cooldown alerts.
  function formatDays(ms: number): string {
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days <= 1) return 'less than a day';
    return `${days} days`;
  }

  const initial = (name || '').trim().charAt(0).toUpperCase() || 'O';

  return (
    <ScreenContainer>
      <View style={styles.photoRow}>
        <View style={styles.avatar}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
          <Pressable
            onPress={pickImage}
            style={styles.cameraBtn}
            accessibilityRole="button"
            accessibilityLabel="Change photo"
          >
            <Ionicons name="camera" size={18} color={colors.textInverse} />
          </Pressable>
        </View>
      </View>

      <View style={styles.form}>
        <Input
          label="Full name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
        />
        <Input
          label="Username"
          value={username}
          onChangeText={(v) =>
            setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))
          }
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          hint="3 to 20 lowercase letters, numbers, or underscores. Friends add you using this handle."
        />
        <Input
          label="Email"
          value={profile?.email ?? ''}
          editable={false}
          hint="Email comes from your Google account and can't be changed here."
        />
        <Input
          label="Phone"
          value={profile?.phone ?? ''}
          editable={false}
          hint="Phone is locked once set. Contact support to change it."
        />
      </View>

      <View style={styles.footer}>
        <Button label="Save changes" onPress={handleSave} />
      </View>
    </ScreenContainer>
  );
}

const AVATAR = 120;

const styles = StyleSheet.create({
  photoRow: {
    alignItems: 'center',
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
    overflow: 'visible',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: AVATAR / 2,
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 48,
    color: colors.primary,
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 36,
    height: 36,
    borderRadius: radius.circle,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.background,
  },
  form: { gap: spacing.md },
  footer: { marginTop: spacing.xl },
});
