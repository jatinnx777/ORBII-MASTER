import React, { useLayoutEffect, useState } from 'react';
import { appAlert } from '@/components/common';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { profileUpdated } from '@/redux/slices/userSlice';
import { isValidName } from '@/utils/validation';
import { isUsernameAvailable } from '@/services/users-public';
import { updateProfile } from '@/services/auth';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'EditProfile'>;

// Instagram-style edit profile: a big calm avatar, a "Change photo" text link,
// then a quiet list of labeled rows. "Done" lives in the header. Warm/neutral
// throughout — red is reserved for emergencies, never for profile chrome.
export function EditProfileScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [name, setName] = useState(profile?.name ?? '');
  const [username, setUsername] = useState(profile?.username ?? '');
  const [photoUri, setPhotoUri] = useState(profile?.photoUri ?? null);
  const [saving, setSaving] = useState(false);

  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);
  const dirty =
    name !== (profile?.name ?? '') ||
    username !== (profile?.username ?? '') ||
    photoUri !== (profile?.photoUri ?? null);

  const pickImage = async () => {
    // Android system Photo Picker — no media permission required.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      Haptics.selectionAsync().catch(() => undefined);
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!profile || saving) return;
    if (!isValidName(name)) {
      appAlert('Name required', 'Please enter a valid name.');
      return;
    }
    if (!usernameValid) {
      appAlert(
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
        appAlert('Username locked', `You can change your username again in ${formatDays(remaining)}.`);
        return;
      }
    }
    if (usernameChanged) {
      const available = await isUsernameAvailable(username, profile.uid);
      if (!available) {
        appAlert('Username taken', `@${username} is already taken. Pick another.`);
        return;
      }
    }
    if (photoChanged && profile.photoChangedAt) {
      const remaining = profile.photoChangedAt + COOLDOWN_MS - now;
      if (remaining > 0) {
        appAlert('Photo locked', `You can change your profile photo again in ${formatDays(remaining)}.`);
        return;
      }
    }

    setSaving(true);
    try {
      const updated = await updateProfile(profile, { name: name.trim(), photoUri, username });
      dispatch(
        profileUpdated({
          ...updated,
          usernameChangedAt: usernameChanged ? now : profile.usernameChangedAt,
        }),
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      // uploadAvatar falls back to the on-device path when the upload fails, so
      // a still-local URI means the photo never reached storage. Say so instead
      // of pretending it saved everywhere.
      if (photoChanged && updated.photoUri?.startsWith('file://')) {
        appAlert(
          'Photo saved on this phone only',
          "We couldn't upload your picture, so it won't appear for your circle or on a new device. Check your connection and try again.",
        );
        return;
      }
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  // "Done" in the header, greyed until there's an actual change (Instagram).
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable onPress={handleSave} hitSlop={10} disabled={!dirty || saving}>
          <Text style={[styles.headerDone, (!dirty || saving) && { color: colors.textMuted }]}>
            {saving ? 'Saving…' : 'Done'}
          </Text>
        </Pressable>
      ),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, username, photoUri, saving, dirty]);

  function formatDays(ms: number): string {
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days <= 1) return 'less than a day';
    return `${days} days`;
  }

  const initial = (name || '').trim().charAt(0).toUpperCase() || 'O';

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.photoBlock}>
        <Pressable onPress={pickImage} style={styles.avatar} accessibilityLabel="Change photo">
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.avatarImg} />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </Pressable>
        <Pressable onPress={pickImage} hitSlop={8}>
          <Text style={styles.changePhoto}>Change photo</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            placeholder="Your name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
        </Field>
        <Divider />
        <Field label="Username">
          <View style={styles.usernameRow}>
            <Text style={styles.at}>@</Text>
            <TextInput
              value={username}
              onChangeText={(v) => setUsername(v.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
              placeholder="username"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { flex: 1 }]}
            />
          </View>
        </Field>
        <Divider />
        <Field label="Email">
          <Text style={styles.locked}>{profile?.email || 'Not set'}</Text>
        </Field>
        <Divider />
        <Field label="Phone">
          <Text style={styles.locked}>{profile?.phone || 'Not set'}</Text>
        </Field>
      </View>

      <Text style={styles.hint}>
        Your handle is how friends add you to their circle. Email comes from Google,
        and phone is locked once set.
      </Text>
    </ScrollView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldControl}>{children}</View>
    </View>
  );
}

function Divider() {
  return <View style={styles.rowDivider} />;
}

const AVATAR = 104;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xxl },
  headerDone: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.sageDeep,
    paddingHorizontal: spacing.xs,
  },
  photoBlock: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontFamily: fontFamilies.poppinsBold, fontSize: 42, color: colors.peachDeep },
  changePhoto: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.sageDeep },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.md,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    gap: spacing.md,
  },
  fieldLabel: {
    width: 92,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.textPrimary,
  },
  fieldControl: { flex: 1 },
  input: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 15,
    color: colors.textPrimary,
    paddingVertical: 4,
  },
  usernameRow: { flexDirection: 'row', alignItems: 'center' },
  at: { fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textMuted },
  locked: { fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textMuted },
  rowDivider: { height: 1, backgroundColor: colors.divider, marginLeft: 92 + spacing.md },
  hint: {
    ...typography.caption,
    fontSize: 12.5,
    lineHeight: 18,
    color: colors.textMuted,
    marginTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
});
