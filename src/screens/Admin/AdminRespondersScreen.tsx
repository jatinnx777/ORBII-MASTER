import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { appAlert, useBrandSheet } from '@/components/common';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import {
  listResponders,
  approveResponder,
  rejectResponder,
  type ResponderApplication,
} from '@/services/admin';

// Admin-only: review responder applications and approve/reject. Reached from
// Profile (the row only shows for admins). Approving a person here is the correct,
// consistent way to create a verified responder, it sets every flag at once.

const STATUS_META: Record<
  ResponderApplication['verificationStatus'],
  { label: string; tint: string; bg: string }
> = {
  pending: { label: 'Pending', tint: colors.goldDeep, bg: colors.goldSoft },
  verified: { label: 'Verified', tint: colors.sageDeep, bg: colors.sageSoft },
  suspended: { label: 'Rejected', tint: colors.coralDeep, bg: colors.coralSoft },
};

export function AdminRespondersScreen() {
  const navigation = useNavigation();
  const sheet = useBrandSheet();
  const [rows, setRows] = useState<ResponderApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await listResponders());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const doApprove = (r: ResponderApplication) => {
    sheet.confirm({
      title: `Approve ${r.name || 'this applicant'}?`,
      body: 'They become a verified responder immediately: dispatchable, and able to earn ORBII coins on a confirmed rescue. Only approve people you have actually vetted.',
      confirmLabel: 'Approve',
      icon: 'shield-checkmark',
      onConfirm: async () => {
        setBusyId(r.userId);
        const ok = await approveResponder(r.userId);
        setBusyId(null);
        if (ok) await load();
        else appAlert('Could not approve', 'Make sure you are an admin and try again.');
      },
    });
  };

  const doReject = (r: ResponderApplication) => {
    sheet.confirm({
      title: `Reject ${r.name || 'this applicant'}?`,
      body: 'Their application is marked rejected and they stay a normal user. You can approve them later if things change.',
      destructive: true,
      confirmLabel: 'Reject',
      icon: 'close-circle',
      onConfirm: async () => {
        setBusyId(r.userId);
        const ok = await rejectResponder(r.userId);
        setBusyId(null);
        if (ok) await load();
        else appAlert('Could not reject', 'Make sure you are an admin and try again.');
      },
    });
  };

  const pending = rows.filter((r) => r.verificationStatus === 'pending');
  const others = rows.filter((r) => r.verificationStatus !== 'pending');

  const renderRow = (r: ResponderApplication) => {
    const meta = STATUS_META[r.verificationStatus];
    const busy = busyId === r.userId;
    return (
      <View key={r.userId} style={styles.card}>
        <View style={styles.rowTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{r.name || 'Unnamed applicant'}</Text>
            <Text style={styles.sub}>{r.email || r.phone || r.userId.slice(0, 8)}</Text>
            {r.category ? <Text style={styles.sub}>{r.category}</Text> : null}
          </View>
          <View style={[styles.badge, { backgroundColor: meta.bg }]}>
            <Text style={[styles.badgeText, { color: meta.tint }]}>{meta.label}</Text>
          </View>
        </View>
        {r.verificationStatus === 'pending' ? (
          <View style={styles.actions}>
            <Pressable
              onPress={() => doReject(r)}
              disabled={busy}
              style={[styles.btn, styles.reject]}
            >
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
            <Pressable
              onPress={() => doApprove(r)}
              disabled={busy}
              style={[styles.btn, styles.approve]}
            >
              <Text style={styles.approveText}>{busy ? '…' : 'Approve'}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.headerTitle}>Responder approvals</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {loading ? (
            <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.xl }} />
          ) : rows.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={30} color={colors.textMuted} />
              <Text style={styles.emptyText}>No applications yet.</Text>
              <Text style={styles.emptyHint}>
                When someone taps "Become a Responder" and applies, they show up here for you to
                approve. If this stays empty and you know people applied, make sure you are set as an
                admin (see ORBII_STATE.md).
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionLabel}>PENDING ({pending.length})</Text>
              {pending.length === 0 ? (
                <Text style={styles.muted}>Nothing waiting. You're all caught up.</Text>
              ) : (
                pending.map(renderRow)
              )}

              {others.length > 0 ? (
                <>
                  <Text style={styles.sectionLabel}>DECIDED</Text>
                  {others.map(renderRow)}
                </>
              ) : null}
            </>
          )}
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
  headerTitle: { ...typography.h3, color: colors.textPrimary },
  scroll: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.sm },

  sectionLabel: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  muted: { ...typography.caption, fontSize: 13, color: colors.textMuted, paddingVertical: spacing.sm },

  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing.md, gap: spacing.sm, ...shadows.card },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  name: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  sub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  badge: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontFamily: fontFamilies.poppinsBold, fontSize: 10.5, letterSpacing: 0.4 },

  actions: { flexDirection: 'row', gap: spacing.sm },
  btn: { flex: 1, paddingVertical: 11, borderRadius: radius.pill, alignItems: 'center' },
  reject: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.coral },
  rejectText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 13.5, color: colors.coralDeep },
  approve: { backgroundColor: colors.sage },
  approveText: { fontFamily: fontFamilies.poppinsBold, fontSize: 13.5, color: colors.textInverse },

  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxl, paddingHorizontal: spacing.lg },
  emptyText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  emptyHint: { ...typography.caption, fontSize: 12.5, color: colors.textMuted, textAlign: 'center', lineHeight: 18 },
});
