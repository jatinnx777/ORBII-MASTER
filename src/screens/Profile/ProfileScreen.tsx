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
import { useIsResponder } from '@/services/roles';
import { comingSoon } from '@/services/coming-soon';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const dispatch = useAppDispatch();
  const sheet = useBrandSheet();
  const profile = useAppSelector((s) => s.user.profile);
  const isResponder = useIsResponder();

  if (!profile) return null;

  const initial = (profile.name || profile.email || 'O').charAt(0).toUpperCase();

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
                  'mailto:jaykumar2470f@gmail.com?subject=ORBII%20feedback',
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
                  icon="flash-outline"
                  label="Missions dashboard"
                  onPress={() => navigation.navigate('Tabs', { screen: 'Missions' })}
                />
                <View style={styles.divider} />
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
              </>
            ) : (
              <SettingRow
                icon="shield-checkmark-outline"
                label="Become an ORBII Responder"
                onPress={() => navigation.navigate('ResponderApplication')}
              />
            )}
          </View>

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
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.brandSoft,
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
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
    marginTop: spacing.md,
    ...shadows.card,
  },
  logoutText: {
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 14.5,
    color: colors.coralDeep,
  },
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.md },
  deleteText: { ...typography.caption, fontSize: 12, color: colors.textMuted },
  version: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
