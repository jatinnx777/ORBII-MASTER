import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { appAlert } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  AVATAR_KEYS,
  avatarEmoji,
  getMyProfile,
  upsertProfile,
  type Gender,
} from '@/services/community-feed';

// Set up (or edit) the anonymous community identity. Separate from the real
// account: only handle, display name, gender and avatar are ever shown.

const GENDERS: { key: Gender; label: string }[] = [
  { key: 'female', label: 'Female' },
  { key: 'male', label: 'Male' },
  { key: 'nonbinary', label: 'Non-binary' },
  { key: 'undisclosed', label: 'Prefer not to say' },
];

export function CommunityProfileSetupScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [handle, setHandle] = useState('');
  const [gender, setGender] = useState<Gender>('undisclosed');
  const [avatarKey, setAvatarKey] = useState<string>(AVATAR_KEYS[0]);
  const [bio, setBio] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const p = await getMyProfile();
        if (!alive) return;
        if (p) {
          setIsEdit(true);
          setDisplayName(p.displayName);
          setHandle(p.handle);
          setGender(p.gender);
          setAvatarKey(p.avatarKey);
          setBio(p.bio ?? '');
        }
        setLoading(false);
      })();
      return () => {
        alive = false;
      };
    }, []),
  );

  const onHandle = (v: string) => setHandle(v.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20));

  const canSave = displayName.trim().length >= 1 && handle.trim().length >= 3;

  const save = async () => {
    if (saving || !canSave) return;
    setSaving(true);
    try {
      const res = await upsertProfile({ handle, displayName, gender, avatarKey, bio: bio.trim() || undefined });
      if (!res.ok) {
        appAlert("Couldn't save", res.error ?? 'Try again.');
        return;
      }
      appAlert(isEdit ? 'Profile updated' : 'You are all set', 'Your community identity is ready.');
      navigation.goBack();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.root, { alignItems: 'center', justifyContent: 'center' }]}>
        <ActivityIndicator color={colors.brand} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
      <View style={styles.previewWrap}>
        <View style={styles.previewAvatar}>
          <Text style={styles.previewEmoji}>{avatarEmoji(avatarKey)}</Text>
        </View>
        <Text style={styles.previewName}>{displayName.trim() || 'Your name'}</Text>
        <Text style={styles.previewHandle}>@{handle || 'handle'}</Text>
      </View>

      <Text style={styles.note}>
        This is your anonymous community identity. Your real name, photo and number are never shown, only what you set here.
      </Text>

      <Text style={styles.label}>Pick an avatar</Text>
      <View style={styles.avatarGrid}>
        {AVATAR_KEYS.map((k) => (
          <Pressable key={k} onPress={() => setAvatarKey(k)} style={[styles.avatarCell, avatarKey === k && styles.avatarCellOn]}>
            <Text style={styles.avatarCellEmoji}>{avatarEmoji(k)}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Display name</Text>
      <TextInput
        value={displayName}
        onChangeText={setDisplayName}
        placeholder="e.g. Night Owl"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        maxLength={30}
      />

      <Text style={styles.label}>Handle</Text>
      <View style={styles.handleRow}>
        <Text style={styles.at}>@</Text>
        <TextInput
          value={handle}
          onChangeText={onHandle}
          placeholder="nightowl_23"
          placeholderTextColor={colors.textMuted}
          style={styles.handleInput}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>
      <Text style={styles.hint}>3-20 lowercase letters, numbers or underscores.</Text>

      <Text style={styles.label}>Gender (the only account detail shown)</Text>
      <View style={styles.genderWrap}>
        {GENDERS.map((g) => (
          <Pressable key={g.key} onPress={() => setGender(g.key)} style={[styles.genderChip, gender === g.key && styles.genderChipOn]}>
            <Text style={[styles.genderText, gender === g.key && styles.genderTextOn]}>{g.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Bio (optional)</Text>
      <TextInput
        value={bio}
        onChangeText={setBio}
        placeholder="A line about you…"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
        maxLength={160}
        multiline
      />

      <Pressable onPress={save} disabled={!canSave || saving} style={[styles.saveBtn, (!canSave || saving) && { opacity: 0.5 }]}>
        <Text style={styles.saveText}>{saving ? 'Saving…' : isEdit ? 'Save changes' : 'Create profile'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },

  previewWrap: { alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  previewAvatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.brandSoft, alignItems: 'center', justifyContent: 'center' },
  previewEmoji: { fontSize: 38 },
  previewName: { fontFamily: fontFamilies.poppinsBold, fontSize: 17, color: colors.textPrimary },
  previewHandle: { fontFamily: fontFamilies.interRegular, fontSize: 13, color: colors.textMuted },

  note: { fontFamily: fontFamilies.interMedium, fontSize: 12.5, color: colors.textSecondary, lineHeight: 18, backgroundColor: colors.brandSoft, borderRadius: radius.md, padding: spacing.md },

  label: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.textPrimary, marginTop: spacing.md },
  hint: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, marginTop: 4 },

  avatarGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  avatarCell: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent', ...shadows.icon },
  avatarCellOn: { borderColor: colors.brand, backgroundColor: colors.brandSoft },
  avatarCellEmoji: { fontSize: 24 },

  input: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 12, fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textPrimary, ...shadows.icon },
  handleRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md, ...shadows.icon },
  at: { fontFamily: fontFamilies.poppinsBold, fontSize: 16, color: colors.textMuted },
  handleInput: { flex: 1, paddingVertical: 12, paddingLeft: 4, fontFamily: fontFamilies.interMedium, fontSize: 15, color: colors.textPrimary },

  genderWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.xs },
  genderChip: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surface, ...shadows.icon },
  genderChipOn: { backgroundColor: colors.brand },
  genderText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 12.5, color: colors.textSecondary },
  genderTextOn: { color: colors.textInverse },

  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.pill, paddingVertical: 15, alignItems: 'center' },
  saveText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textInverse },
});
