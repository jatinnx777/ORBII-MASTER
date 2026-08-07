import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppSelector } from '@/redux/store';
import {
  guardianLevel,
  loadHelperProfileSafe,
  type GuardianLevel,
  type HelperProfile,
} from '@/services/helper-profile';

const TIERS: { level: GuardianLevel; req: string; perks: string; color: string }[] = [
  { level: 'Bronze', req: 'New verified responder', perks: 'Respond to nearby emergencies', color: '#A9743B' },
  { level: 'Silver', req: '10+ people assisted · trust 60+', perks: 'Priority dispatch · Silver badge', color: '#6B7280' },
  { level: 'Gold', req: '50+ people assisted · trust 75+', perks: 'Certificate · community recognition', color: colors.goldDeep },
  { level: 'Elite', req: '150+ people assisted · trust 90+', perks: 'Elite status · partner perks · featured', color: colors.lavenderDeep },
];

export function ResponderRecognitionScreen() {
  const navigation = useNavigation();
  const profile = useAppSelector((s) => s.user.profile);
  const [hp, setHp] = useState<HelperProfile | null>(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!profile?.uid) return;
        const p = await loadHelperProfileSafe(profile.uid);
        if (alive) setHp(p);
      })();
      return () => {
        alive = false;
      };
    }, [profile?.uid]),
  );

  const current = hp ? guardianLevel(hp) : 'Bronze';

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Recognition</Text>
          <View style={{ width: 40 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <Ionicons name="ribbon" size={28} color={colors.goldDeep} />
            <Text style={styles.heroLevel}>{current} Guardian</Text>
            <Text style={styles.heroSub}>
              {hp?.lifetimeResponses ?? 0} people assisted · trust {hp?.trustScore ?? 0}
            </Text>
          </View>

          <Text style={styles.sectionLabel}>GUARDIAN LEVELS</Text>
          {TIERS.map((t) => {
            const active = t.level === current;
            return (
              <View key={t.level} style={[styles.tier, active && styles.tierActive]}>
                <View style={[styles.tierDot, { backgroundColor: t.color }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.tierTop}>
                    <Text style={styles.tierName}>{t.level}</Text>
                    {active ? (
                      <View style={styles.youPill}>
                        <Text style={styles.youText}>YOU</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.tierReq}>{t.req}</Text>
                  <Text style={styles.tierPerks}>{t.perks}</Text>
                </View>
              </View>
            );
          })}

          <Text style={styles.footnote}>
            ORBII recognises responders by impact and trust — not money. Every
            verified response makes someone safer, and moves you up.
          </Text>
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
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xxl,
    padding: spacing.lg,
    alignItems: 'center',
    gap: 4,
    ...shadows.card,
  },
  heroLevel: { fontFamily: fontFamilies.poppinsBold, fontSize: 22, color: colors.textPrimary },
  heroSub: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: colors.textMuted,
  },
  tier: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  tierActive: {
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: colors.goldSoft,
    shadowColor: colors.goldDeep,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  tierDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  tierTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierName: { fontFamily: fontFamilies.poppinsBold, fontSize: 15.5, color: colors.textPrimary },
  youPill: { backgroundColor: colors.goldSoft, paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.pill },
  youText: { fontFamily: fontFamilies.poppinsBold, fontSize: 9.5, color: colors.goldDeep, letterSpacing: 0.5 },
  tierReq: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  tierPerks: { ...typography.caption, fontSize: 12, color: colors.sageDeep, marginTop: 2 },
  footnote: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, lineHeight: 17, textAlign: 'center', marginTop: spacing.xs },
});
