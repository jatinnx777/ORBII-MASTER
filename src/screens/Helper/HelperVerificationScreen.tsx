import React, { useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Button, Card, Input, ScreenContainer } from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { helperVerificationSet } from '@/redux/slices/helperSlice';
import { helperModeToggled } from '@/redux/slices/userSlice';
import { trackEvent } from '@/services/analytics';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'HelperVerification'>;

export function HelperVerificationScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const verification = useAppSelector((s) => s.helper.verification);

  const [aadhaar, setAadhaar] = useState('');
  const [aadhaarPhoto, setAadhaarPhoto] = useState<string | null>(null);
  const [selfie, setSelfie] = useState<string | null>(null);
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const aadhaarOk = /^\d{12}$/.test(aadhaar.replace(/\s/g, ''));
  const canSubmit =
    aadhaarOk && !!aadhaarPhoto && !!selfie && address.trim().length > 5;

  const pickAadhaar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
    });
    if (!r.canceled && r.assets[0]) setAadhaarPhoto(r.assets[0].uri);
  };

  const takeSelfie = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera needed', 'We need camera access for the live selfie check.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      cameraType: ImagePicker.CameraType.front,
      quality: 0.6,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (!r.canceled && r.assets[0]) setSelfie(r.assets[0].uri);
  };

  const handleSubmit = () => {
    setSubmitting(true);
    // TODO: upload to Firebase Storage + write /helper_verifications doc.
    setTimeout(() => {
      setSubmitting(false);
      dispatch(helperVerificationSet('verified'));
      dispatch(helperModeToggled(true));
      trackEvent('helper_verified');
      Alert.alert(
        'Verification complete',
        'For the demo, we auto-approve instantly. In production this takes up to 48h.',
        [{ text: 'Continue', onPress: () => navigation.replace('HelperDashboard') }],
      );
    }, 1200);
  };

  if (verification === 'verified') {
    return (
      <ScreenContainer>
        <View style={styles.done}>
          <Ionicons name="shield-checkmark" size={64} color={colors.success} />
          <Text style={styles.doneTitle}>You're verified</Text>
          <Text style={styles.doneBody}>
            You can switch helper mode on from the dashboard.
          </Text>
          <Button
            label="Open dashboard"
            onPress={() => navigation.replace('HelperDashboard')}
          />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Become an ORBII helper</Text>
        <Text style={styles.subtitle}>
          Complete a one-time KYC check. Takes under 2 minutes. You earn ₹100 per resolved SOS.
        </Text>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>1. Aadhaar details</Text>
          <Input
            label="Aadhaar number"
            value={aadhaar}
            onChangeText={(t) => setAadhaar(t.replace(/\D/g, '').slice(0, 12))}
            keyboardType="number-pad"
            placeholder="12-digit number"
            maxLength={12}
          />

          <Pressable onPress={pickAadhaar} style={styles.uploader}>
            {aadhaarPhoto ? (
              <Image source={{ uri: aadhaarPhoto }} style={styles.uploadPreview} />
            ) : (
              <View style={styles.uploadEmpty}>
                <Ionicons name="document-attach" size={28} color={colors.textMuted} />
                <Text style={styles.uploadText}>Upload Aadhaar photo</Text>
              </View>
            )}
          </Pressable>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>2. Live selfie</Text>
          <Text style={styles.helper}>
            Used to match your face to your Aadhaar photo.
          </Text>
          <Pressable onPress={takeSelfie} style={styles.uploader}>
            {selfie ? (
              <Image source={{ uri: selfie }} style={styles.uploadPreview} />
            ) : (
              <View style={styles.uploadEmpty}>
                <Ionicons name="camera" size={28} color={colors.textMuted} />
                <Text style={styles.uploadText}>Take selfie</Text>
              </View>
            )}
          </Pressable>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>3. Address</Text>
          <Input
            label="Current address"
            value={address}
            onChangeText={setAddress}
            placeholder="Street, area, city, PIN"
            multiline
            numberOfLines={3}
          />
        </Card>

        <View style={styles.disclaimer}>
          <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
          <Text style={styles.disclaimerText}>
            Your documents are encrypted and never shown to users you help.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={submitting ? 'Submitting…' : 'Submit for verification'}
          onPress={handleSubmit}
          disabled={!canSubmit}
          loading={submitting}
        />
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
  },
  sectionCard: {
    gap: spacing.sm,
  },
  sectionTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  helper: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  uploader: {
    borderRadius: radius.sm,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  uploadEmpty: {
    minHeight: 140,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surface,
  },
  uploadText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  uploadPreview: {
    width: '100%',
    height: 200,
    resizeMode: 'cover',
  },
  disclaimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  disclaimerText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  footer: {
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  done: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.xxl,
  },
  doneTitle: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 22,
    color: colors.textPrimary,
  },
  doneBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
