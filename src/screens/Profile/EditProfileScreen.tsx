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
  const [photoUri, setPhotoUri] = useState(profile?.photoUri ?? null);

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
    dispatch(profileUpdated({ ...profile, name: name.trim(), photoUri }));
    navigation.goBack();
  };

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
          label="Phone"
          value={profile?.phone ?? ''}
          editable={false}
          hint="Phone number can't be changed. Contact support if needed."
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
