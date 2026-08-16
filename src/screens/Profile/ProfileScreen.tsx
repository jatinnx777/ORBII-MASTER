import React from 'react';
import {
  Image,
  Linking,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useBrandSheet } from '@/components/common';
import { APP_VERSION } from '@/services/app-info';
import { colors, fontFamilies, radius, shadows, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle, deleteAccount } from '@/services/auth';
import { clearCachedContacts } from '@/services/emergency-contacts';
import { clearCachedProfile } from '@/services/profile-cache';
import { clearPin } from '@/services/safety-pin';
import { useIsResponder, useIsAdmin } from '@/services/roles';
import { comingSoon } from '@/services/coming-soon';
import type { AppStackParamList } from '@/navigation/types';
import { useTabBarScroll } from '@/navigation/tabBarVisibility';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const onTabScroll = useTabBarScroll();
  const dispatch = useAppDispatch();
  const sheet = useBrandSheet();
  const profile = useAppSelector((s) => s.user.profile);
  const isResponder = useIsResponder();
  const isAdmin = useIsAdmin();

  if (!profile) return null;

  const initial = (profile.name || profile.email || 'O').charAt(0).toUpperCase();
  const plan = profile.premiumTier ?? null;

  const handleSignOut = () => {
    sheet.confirm({
      title: 'Sign out?',
      body: 'You can sign back in anytime. Your local profile and history will be cleared from this device.',
      destructive: true,
      confirmLabel: 'Sign out',
      icon: 'log-out',
      onConfirm: async () => {
        await signOutFromGoogle();
        // The PIN lives on the device, not the account. Clear it so the next
        // person to sign in on this phone isn't locked behind a PIN they
        // never chose (and can't cancel an SOS).
        await clearPin().catch(() => undefined);
        dispatch(signedOut());
      },
    });
  };

  const handleDeleteAccount = () => {
    sheet.confirm({
      title: 'Delete your account?',
      body: 'This permanently erases your ORBII account, profile, contacts, SOS history and any helper data. This cannot be undone.',
      destructive: true,
      confirmLabel: 'Delete forever',
      icon: 'trash',
      onConfirm: async () => {
        const res = await deleteAccount();
        if (!res.ok) {
          sheet.notify({
            title: 'Could not delete account',
            body: res.error ?? 'Please try again.',
            tone: 'destructive',
          });
          return;
        }
        // A deleted account must leave no local trace.
        await clearCachedContacts(profile.uid).catch(() => undefined);
        await clearCachedProfile(profile.uid).catch(() => undefined);
        await clearPin().catch(() => undefined);
        dispatch(signedOut());
      },
    });
  };

  const shareApp = async () => {
    try {
      await Share.share({
        message:
          'ORBII gets a woman help before she can even reach her phone. Download: https://orbii.in',
      });
    } catch {
      // dismissed
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 110 }]}
          showsVerticalScrollIndicator={false}
          onScroll={onTabScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.header}>
            <Text style={styles.title}>Profile</Text>
            <Text style={styles.sub}>Protected and secure</Text>
          </View>

          {/* ── Identity ── */}
          <Pressable
            onPress={() => navigation.navigate('EditProfile')}
            style={({ pressed }) => [styles.idCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Edit your profile"
          >
            {profile.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.idName} numberOfLines={1}>
                {profile.name || 'Your name'}
              </Text>
              <Text style={styles.idSub} numberOfLines={1}>
                {profile.phone || profile.email || 'Tap to complete your profile'}
              </Text>
            </View>
            <View style={styles.editBtn}>
              <Ionicons name="pencil" size={15} color={colors.brandDeep} />
            </View>
          </Pressable>

          {/* ── Subscription (moved here from the old Plus tab) ── */}
          <Pressable
            onPress={() => navigation.navigate('PremiumUpgrade')}
            style={({ pressed }) => [styles.planCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Manage your plan"
          >
            <View style={styles.planIcon}>
              <Ionicons name="sparkles" size={18} color={colors.goldDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>
                {plan === 'family' ? 'ORBII Family' : plan === 'plus' ? 'ORBII Plus' : 'Go Pro with ORBII'}
              </Text>
              <Text style={styles.planSub}>
                {plan === 'family'
                  ? 'Your family plan is active. Tap to manage.'
                  : plan === 'plus'
                    ? 'Plus is active. Tap to manage or upgrade to Family.'
                    : 'Verified helpers reach you, not just your circle.'}
              </Text>
            </View>
            {plan ? (
              <View style={styles.planActive}>
                <Text style={styles.planActiveText}>Active</Text>
              </View>
            ) : (
              <View style={styles.planUpgrade}>
                <Text style={styles.planUpgradeText}>Upgrade</Text>
              </View>
            )}
          </Pressable>

          {/* ── Help train ORBII (opt-in voice donation) ── */}
          <Pressable
            onPress={() => navigation.navigate('VoiceDonation')}
            style={({ pressed }) => [styles.planCard, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Help train ORBII"
          >
            <View style={[styles.planIcon, { backgroundColor: colors.brandSoft }]}>
              <Ionicons name="mic" size={18} color={colors.brandDeep} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>Help train ORBII</Text>
              <Text style={styles.planSub}>Donate a few voice clips to help it hear more women. Optional.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </Pressable>

          {/* ── Responder Missions (golden, just below the plan; responders only) ── */}
          {isResponder ? (
            <Pressable
              onPress={() => navigation.navigate('Missions')}
              style={({ pressed }) => [styles.missionsShadow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Open your responder Missions dashboard"
            >
              <LinearGradient
                colors={[colors.goldSoft, '#F6E4BC']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.missionsCard}
              >
                <View style={styles.missionsIcon}>
                  <Ionicons name="flash" size={18} color={colors.goldDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planTitle}>Responder Missions</Text>
                  <Text style={styles.planSub}>Go online, take missions, earn ORBII coins.</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.goldDeep} />
              </LinearGradient>
            </Pressable>
          ) : null}

          {/* ── Grid ── */}
          <View style={styles.grid}>
            <GridItem
              icon="time-outline"
              label="SOS history"
              onPress={() => navigation.navigate('History')}
            />
            <GridItem
              icon="people-outline"
              label="Trusted circle"
              onPress={() => navigation.navigate('Circles')}
            />
            <GridItem
              icon="folder-open-outline"
              label="Evidence vault"
              onPress={() => navigation.navigate('Recordings')}
            />
            <GridItem
              icon="help-circle-outline"
              label="FAQ"
              onPress={() => navigation.navigate('About')}
            />
            <GridItem
              icon="call-outline"
              label="Helpline"
              onPress={() => Linking.openURL('tel:112').catch(() => undefined)}
            />
            <GridItem
              icon="compass-outline"
              label="Help tour"
              onPress={() => navigation.navigate('SafetyReadiness')}
            />
            <GridItem
              icon="chatbox-ellipses-outline"
              label="Feedback"
              onPress={() =>
                Linking.openURL(
                  'mailto:orbiisafety@gmail.com?subject=ORBII%20feedback',
                ).catch(() => comingSoon('Feedback'))
              }
            />
            <GridItem icon="share-social-outline" label="Share app" onPress={shareApp} />
          </View>

          {/* ── Responder ── */}
          <Text style={styles.sectionLabel}>RESPONDER</Text>
          <View style={styles.card}>
            {isResponder ? (
              <>
                <SettingRow
                  icon="trophy-outline"
                  label="Recognition & Guardian level"
                  onPress={() => navigation.navigate('ResponderRecognition')}
                />
                <View style={styles.divider} />
                <SettingRow
                  icon="wallet-outline"
                  label="Earnings & payouts"
                  onPress={() => navigation.navigate('ResponderEarnings')}
                />
                <View style={styles.divider} />
                <SettingRow
                  icon="server-outline"
                  label="ORBII coins"
                  onPress={() => navigation.navigate('CoinsWallet')}
                />
              </>
            ) : (
              <>
                <SettingRow
                  icon="people-outline"
                  label="Community Guardian, help people nearby"
                  onPress={() => navigation.navigate('CommunityGuardian')}
                />
                <View style={styles.divider} />
                <SettingRow
                  icon="shield-checkmark-outline"
                  label="Become an ORBII Responder"
                  onPress={() => navigation.navigate('ResponderApplication')}
                />
              </>
            )}
          </View>

          {/* ── Admin (only for admins) ── */}
          {isAdmin ? (
            <>
              <Text style={styles.sectionLabel}>ADMIN</Text>
              <View style={styles.card}>
                <SettingRow
                  icon="shield-checkmark-outline"
                  label="Responder approvals"
                  onPress={() => navigation.navigate('AdminResponders')}
                />
              </View>
            </>
          ) : null}

          {/* ── Settings ── */}
          <Text style={styles.sectionLabel}>SETTINGS</Text>
          <View style={styles.card}>
            <SettingRow
              icon="lock-closed-outline"
              label="Privacy & security"
              onPress={() => navigation.navigate('SafetyPin')}
            />
            <View style={styles.divider} />
            <SettingRow
              icon="settings-outline"
              label="General"
              onPress={() => navigation.navigate('Settings')}
            />
            <View style={styles.divider} />
            <SettingRow
              icon="information-circle-outline"
              label="About ORBII"
              onPress={() => navigation.navigate('About')}
            />
          </View>

          {/* ── Danger zone ── */}
          <Pressable
            onPress={handleSignOut}
            style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Log out"
          >
            <Ionicons name="log-out-outline" size={18} color={colors.coralDeep} />
            <Text style={styles.logoutText}>Log out</Text>
          </Pressable>

          <Pressable onPress={handleDeleteAccount} hitSlop={8} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>Delete my account</Text>
          </Pressable>

          <Text style={styles.version}>ORBII v{APP_VERSION}</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function GridItem({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.gridItem, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.gridIcon}>
        <Ionicons name={icon} size={20} color={colors.brandDeep} />
      </View>
      <Text style={styles.gridLabel} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
}

function SettingRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={styles.settingIcon}>
        <Ionicons name={icon} size={17} color={colors.brandDeep} />
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  pressed: { opacity: 0.92 },
  header: { paddingTop: spacing.md, paddingBottom: spacing.sm },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
  sub: { ...typography.caption, fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },

  idCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    ...shadows.card,
  },
  avatar: { width: 54, height: 54, borderRadius: 27, backgroundColor: colors.creamDeep },
  avatarFallback: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 21,
    color: colors.brandDeep,
  },
  idName: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 17,
    color: colors.textPrimary,
  },
  idSub: { ...typography.caption, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  editBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.goldSoft,
    marginTop: spacing.xs,
    ...shadows.card,
  },
  planIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.goldSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planTitle: { fontFamily: fontFamilies.poppinsBold, fontSize: 15, color: colors.textPrimary },
  planSub: { ...typography.caption, fontSize: 11.5, color: colors.textSecondary, marginTop: 1, lineHeight: 15 },
  planActive: {
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  planActiveText: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 11.5, color: colors.brandDeep },
  planUpgrade: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  planUpgradeText: { fontFamily: fontFamilies.poppinsBold, fontSize: 12, color: colors.textPrimary },
  missionsShadow: {
    borderRadius: radius.xl,
    marginTop: spacing.sm,
    shadowColor: colors.goldDeep,
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  missionsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.gold,
    overflow: 'hidden',
  },
  missionsIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: '30%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
    gap: 8,
    ...shadows.card,
  },
  gridIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: colors.lavenderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridLabel: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 11.5,
    color: colors.textPrimary,
    textAlign: 'center',
  },

  sectionLabel: {
    ...typography.label,
    fontSize: 13,
    color: colors.textMuted,
    letterSpacing: 0.1,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    ...shadows.card,
    overflow: 'hidden',
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  settingIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14,
    color: colors.textPrimary,
  },
  divider: { height: 1, backgroundColor: colors.divider, marginLeft: 62 },

  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingVertical: 14,
    marginTop: spacing.xl,
    ...shadows.card,
  },
  logoutText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.coralDeep,
  },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.sm },
  deleteText: { ...typography.caption, fontSize: 11.5, color: colors.textMuted, opacity: 0.85 },
  version: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
