import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import { loadHelperProfileSafe, type HelperProfile } from '@/services/helper-profile';
import {
  pickAndUploadDoc,
  signedDocUrl,
  submitForReview,
  type DocKind,
} from '@/services/responder-docs';
import { useBrandSheet } from '@/components/common';

type DocSpec = {
  kind: DocKind;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  path: (p: HelperProfile | null) => string | null;
};

// Four documents the responder uploads from their gallery. Admin reviews them
// in Supabase (Storage → responder-docs) and approves by setting role.
const DOCS: DocSpec[] = [
  {
    kind: 'photo',
    icon: 'person-circle',
    title: 'Profile photo',
    body: 'A clear photo of your face.',
    path: (p) => p?.photoDoc ?? null,
  },
  {
    kind: 'aadhaar',
    icon: 'finger-print',
    title: 'Aadhaar card',
    body: 'Front of your Aadhaar card.',
    path: (p) => p?.aadhaarDoc ?? null,
  },
  {
    kind: 'pan',
    icon: 'card',
    title: 'PAN card',
    body: 'Front of your PAN card.',
    path: (p) => p?.panDoc ?? null,
  },
  {
    kind: 'selfie',
    icon: 'happy',
    title: 'Selfie with Aadhaar',
    body: 'A selfie holding your Aadhaar card next to your face.',
    path: (p) => p?.selfieDoc ?? null,
  },
];

export function ResponderVerificationScreen() {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.user.profile);
  const sheet = useBrandSheet();
  const [hp, setHp] = useState<HelperProfile | null>(null);
  const [busy, setBusy] = useState<DocKind | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Local preview URIs keyed by kind (signed URL or fresh pick).
  const [previews, setPreviews] = useState<Partial<Record<DocKind, string>>>({});

  const refresh = useCallback(async () => {
    if (!profile?.uid) return;
    const p = await loadHelperProfileSafe(profile.uid);
    setHp(p);
    // Resolve signed preview URLs for already-uploaded docs.
    if (p) {
      const next: Partial<Record<DocKind, string>> = {};
      await Promise.all(
        DOCS.map(async (d) => {
          const path = d.path(p);
          if (path) {
            const url = await signedDocUrl(path);
            if (url) next[d.kind] = url;
          }
        }),
      );
      setPreviews(next);
    }
  }, [profile?.uid]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        await refresh();
      })();
      return () => {
        alive = false;
      };
    }, [refresh]),
  );

  const handleUpload = async (kind: DocKind) => {
    if (!profile?.uid || busy) return;
    setBusy(kind);
    const path = await pickAndUploadDoc(profile.uid, kind);
    if (path) {
      const url = await signedDocUrl(path);
      setPreviews((prev) => ({ ...prev, [kind]: url ?? prev[kind] }));
      setHp((prev) =>
        prev
          ? {
              ...prev,
              aadhaarDoc: kind === 'aadhaar' ? path : prev.aadhaarDoc,
              panDoc: kind === 'pan' ? path : prev.panDoc,
              selfieDoc: kind === 'selfie' ? path : prev.selfieDoc,
              photoDoc: kind === 'photo' ? path : prev.photoDoc,
            }
          : prev,
      );
    }
    setBusy(null);
  };

  const uploadedCount = DOCS.filter((d) => !!d.path(hp)).length;
  const allUploaded = uploadedCount === DOCS.length;
  const submitted = !!hp?.submittedAt;

  const handleSubmit = async () => {
    if (!profile?.uid || !allUploaded || submitting) return;
    setSubmitting(true);
    await submitForReview(profile.uid);
    setSubmitting(false);
    await refresh();
    sheet.notify({
      title: 'Submitted for review',
      body: 'Our team will verify your documents. You’ll be able to go online once approved.',
      tone: 'success',
    });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Verification</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.intro}>
            ORBII responders are verified people, not anonymous strangers. Upload
            these from your gallery once — our team reviews them before you can
            go online.
          </Text>

          {hp?.verificationStatus === 'verified' ? (
            <View style={[styles.banner, styles.bannerOk]}>
              <Ionicons name="shield-checkmark" size={18} color={colors.sageDeep} />
              <Text style={[styles.bannerText, { color: colors.sageDeep }]}>
                You’re verified. Thank you for protecting others.
              </Text>
            </View>
          ) : submitted ? (
            <View style={[styles.banner, styles.bannerPending]}>
              <Ionicons name="time" size={18} color={colors.peachDeep} />
              <Text style={[styles.bannerText, { color: colors.peachDeep }]}>
                Submitted — under review. We’ll notify you once approved.
              </Text>
            </View>
          ) : null}

          {DOCS.map((d) => {
            const uploaded = !!d.path(hp);
            const preview = previews[d.kind];
            const isBusy = busy === d.kind;
            return (
              <View key={d.kind} style={styles.card}>
                <View style={styles.cardRow}>
                  <View style={[styles.cardIcon, uploaded && styles.cardIconDone]}>
                    {preview ? (
                      <Image source={{ uri: preview }} style={styles.thumb} />
                    ) : (
                      <Ionicons
                        name={uploaded ? 'checkmark' : d.icon}
                        size={20}
                        color={uploaded ? colors.sageDeep : colors.peachDeep}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>{d.title}</Text>
                    <Text style={styles.cardBody}>{d.body}</Text>
                  </View>
                </View>
                <Pressable
                  onPress={() => handleUpload(d.kind)}
                  disabled={isBusy || submitted}
                  style={({ pressed }) => [
                    styles.uploadBtn,
                    uploaded && styles.uploadBtnDone,
                    (isBusy || submitted) && { opacity: 0.6 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  {isBusy ? (
                    <ActivityIndicator size="small" color={colors.peachDeep} />
                  ) : (
                    <>
                      <Ionicons
                        name={uploaded ? 'refresh' : 'image'}
                        size={16}
                        color={uploaded ? colors.sageDeep : colors.peachDeep}
                      />
                      <Text
                        style={[
                          styles.uploadBtnText,
                          uploaded && { color: colors.sageDeep },
                        ]}
                      >
                        {uploaded ? 'Replace from gallery' : 'Upload from gallery'}
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>
            );
          })}

          <Pressable
            onPress={handleSubmit}
            disabled={!allUploaded || submitted || submitting}
            style={({ pressed }) => [
              styles.submit,
              (!allUploaded || submitted) && styles.submitDisabled,
              pressed && allUploaded && !submitted && { opacity: 0.9 },
            ]}
          >
            {submitting ? (
              <ActivityIndicator size="small" color={colors.surface} />
            ) : (
              <Text style={styles.submitText}>
                {submitted
                  ? 'Submitted'
                  : allUploaded
                    ? 'Submit for review'
                    : `Upload all ${DOCS.length} documents (${uploadedCount}/${DOCS.length})`}
              </Text>
            )}
          </Pressable>

          <View style={styles.note}>
            <Ionicons name="lock-closed" size={16} color={colors.lavenderDeep} />
            <Text style={styles.noteText}>
              Your documents are stored privately and used only to verify you.
              They are never shared with the people you help.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
  intro: { ...typography.body, fontSize: 14, color: colors.textSecondary, marginBottom: spacing.xs },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  bannerOk: { backgroundColor: colors.sageSoft },
  bannerPending: { backgroundColor: colors.peachSoft },
  bannerText: { flex: 1, fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 12,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  cardIconDone: { backgroundColor: colors.sageSoft },
  thumb: { width: 46, height: 46, borderRadius: 12 },
  cardTitle: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 14.5, color: colors.textPrimary },
  cardBody: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1, lineHeight: 16 },
  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.peachSoft,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
  },
  uploadBtnDone: { backgroundColor: colors.sageSoft },
  uploadBtnText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13, color: colors.peachDeep },
  submit: {
    backgroundColor: colors.peachDeep,
    borderRadius: radius.xl,
    paddingVertical: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    ...shadows.card,
  },
  submitDisabled: { backgroundColor: colors.peach, opacity: 0.7 },
  submitText: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.surface },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.lavenderSoft,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  noteText: { flex: 1, ...typography.caption, fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
});
