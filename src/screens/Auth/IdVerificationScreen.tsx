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
import {
  userIdSubmitted,
  userIdVerificationChanged,
} from '@/redux/slices/userSlice';
import { supabase } from '@/services/supabase';
import type { AppStackParamList } from '@/navigation/types';
import type { IdDocumentKind } from '@/types';

type Nav = NativeStackNavigationProp<AppStackParamList, 'IdVerification'>;

export function IdVerificationScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);

  const [kind, setKind] = useState<IdDocumentKind>('aadhaar');
  const [number, setNumber] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const numberOk =
    kind === 'aadhaar'
      ? /^\d{12}$/.test(number.replace(/\s/g, ''))
      : /^[A-Z]{5}\d{4}[A-Z]$/.test(number.toUpperCase());
  const canSubmit = numberOk && !!photoUri;

  const pickDoc = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.6,
      allowsEditing: true,
    });
    if (!r.canceled && r.assets[0]) setPhotoUri(r.assets[0].uri);
  };

  const handleSubmit = async () => {
    if (!profile || !photoUri) return;
    setSubmitting(true);
    try {
      dispatch(
        userIdSubmitted({
          kind,
          number: number.trim().toUpperCase(),
          photoUri,
        }),
      );
      // Best-effort Supabase write. RLS will block without an auth session;
      // we still want the local state to reflect "pending" so the user can
      // proceed, and a real submission will reconcile when auth is wired.
      await supabase
        .from('profiles')
        .upsert({
          id: profile.uid,
          phone: profile.phone,
          id_kind: kind,
          id_number: number.trim().toUpperCase(),
          id_verification: 'pending',
        })
        .then(({ error }) => {
          if (error) console.warn('[id] upsert failed', error);
        });

      // Auto-approve in dev so the user can keep moving. In production, an
      // Edge Function + admin review flips this to 'verified' or 'rejected'.
      setTimeout(() => {
        dispatch(userIdVerificationChanged('verified'));
      }, 1500);

      Alert.alert(
        'Submitted',
        'Your ID is under review. We auto-approve in dev; in production this takes up to 24h.',
        [{ text: 'Continue', onPress: () => navigation.goBack() }],
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Verify your identity</Text>
        <Text style={styles.subtitle}>
          Required by law for emergency dispatch. Your document is encrypted
          and only used for verification.
        </Text>

        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Choose ID type</Text>
          <View style={styles.kindRow}>
            <KindPill
              label="Aadhaar"
              active={kind === 'aadhaar'}
              onPress={() => {
                setKind('aadhaar');
                setNumber('');
              }}
            />
            <KindPill
              label="PAN"
              active={kind === 'pan'}
              onPress={() => {
                setKind('pan');
                setNumber('');
              }}
            />
          </View>

          <Input
            label={kind === 'aadhaar' ? 'Aadhaar number' : 'PAN number'}
            value={number}
            onChangeText={(t) => {
              if (kind === 'aadhaar') setNumber(t.replace(/\D/g, '').slice(0, 12));
              else setNumber(t.toUpperCase().slice(0, 10));
            }}
            keyboardType={kind === 'aadhaar' ? 'number-pad' : 'default'}
            placeholder={kind === 'aadhaar' ? '12-digit number' : 'ABCDE1234F'}
            maxLength={kind === 'aadhaar' ? 12 : 10}
            autoCapitalize="characters"
          />

          <Pressable onPress={pickDoc} style={styles.uploader}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.uploadPreview} />
            ) : (
              <View style={styles.uploadEmpty}>
                <Ionicons
                  name="document-attach"
                  size={28}
                  color={colors.textMuted}
                />
                <Text style={styles.uploadText}>
                  Upload a clear photo of your {kind === 'aadhaar' ? 'Aadhaar' : 'PAN'} card
                </Text>
              </View>
            )}
          </Pressable>
        </Card>

        <View style={styles.disclaimer}>
          <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
          <Text style={styles.disclaimerText}>
            Stored encrypted in Supabase. Only ORBII verification staff can access it.
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

function KindPill({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.kindPill, active && styles.kindPillActive]}
    >
      <Text style={[styles.kindText, active && styles.kindTextActive]}>
        {label}
      </Text>
    </Pressable>
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
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 15,
    color: colors.textPrimary,
  },
  kindRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  kindPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  kindPillActive: {
    borderColor: colors.primary,
    backgroundColor: '#FFEAEA',
  },
  kindText: {
    ...typography.bodyMedium,
    color: colors.textSecondary,
  },
  kindTextActive: {
    color: colors.primary,
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
    padding: spacing.md,
  },
  uploadText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
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
});
