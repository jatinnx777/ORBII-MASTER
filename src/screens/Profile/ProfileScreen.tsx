import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  Card,
  Row,
  ScreenContainer,
  SectionHeader,
  useBrandSheet,
} from '@/components/common';
import { APP_VERSION } from '@/services/app-info';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle, deleteAccount } from '@/services/auth';
import { clearCachedContacts } from '@/services/emergency-contacts';
import { clearCachedProfile } from '@/services/profile-cache';
import { clearPin } from '@/services/safety-pin';
import { useIsResponder } from '@/services/roles';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const history = useAppSelector((s) => s.history.records);
  const isResponder = useIsResponder();

  if (!profile) return null;

  const initial = (profile.name || profile.email || 'O').charAt(0).toUpperCase();
  const sosCount = history.length;

  const sheet = useBrandSheet();
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

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Profile</Text>
        </View>
        <Card style={styles.heroCard}>
          <View style={styles.avatarWrap}>
            {profile.photoUri ? (
              <Image source={{ uri: profile.photoUri }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatar}>
                <Text style={styles.avatarInitial}>{initial}</Text>
              </View>
            )}
            {profile.isPremium ? (
              <View style={styles.premiumBadge}>
                <Ionicons name="ribbon" size={14} color={colors.dark} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{profile.name ?? 'ORBII user'}</Text>
              {isResponder ? (
                <Text style={styles.crown} accessibilityLabel="Verified helper">
                  {'\u{1F451}'}
                </Text>
              ) : null}
            </View>
            <Text style={styles.phone}>{profile.email || profile.phone || ''}</Text>
            <View style={styles.heroStats}>
              <StatPill label="SOS sent" value={String(sosCount)} />
              <StatPill
                label="Contacts"
                value={String(profile.emergencyContacts.length)}
              />
              {null}
            </View>
          </View>
        </Card>

        <SectionHeader title="Safety" />
        <Card style={styles.rowsCard}>
          <Row
            icon="people"
            tint="coral"
            label="Emergency contacts"
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
          <Divider />
          <Row
            icon="ribbon"
            tint="gold"
            label="ORBII plans"
            onPress={() => navigation.navigate('PremiumUpgrade')}
          />
          <Divider />
          <Row
            icon="time"
            tint="peach"
            label="SOS history"
            onPress={() => navigation.navigate('History')}
          />
        </Card>

        {isResponder ? (
          <>
            <SectionHeader title="Responder" />
            <Card style={styles.rowsCard}>
              <Row
                icon="flash"
                tint="gold"
            label="Missions dashboard"
                onPress={() => navigation.navigate('Tabs', { screen: 'Missions' })}
              />
              <Divider />
              <Row
                icon="wallet"
                tint="sage"
            label="Earnings & payouts"
                onPress={() => navigation.navigate('ResponderEarnings')}
              />
              <Divider />
              <Row
                icon="ribbon"
                tint="gold"
            label="Recognition & Guardian level"
                onPress={() => navigation.navigate('ResponderRecognition')}
              />
              <Divider />
              <Row
                icon="shield-checkmark"
                tint="sage"
            label="Verification"
                onPress={() => navigation.navigate('ResponderVerification')}
              />
            </Card>
          </>
        ) : (
          <>
            <SectionHeader title="Help others" />
            <Card style={styles.rowsCard}>
              <Row
                icon="shield-checkmark"
                tint="sage"
            label="Become an ORBII Responder"
                onPress={() => navigation.navigate('ResponderApplication')}
              />
            </Card>
          </>
        )}

        <SectionHeader title="Account" />
        <Card style={styles.rowsCard}>
          <Row
            icon="person-circle"
            tint="peach"
            label="Edit profile"
            onPress={() => navigation.navigate('EditProfile')}
          />
          <Divider />
          <Row
            icon="settings"
            tint="neutral"
            label="Settings"
            onPress={() => navigation.navigate('Settings')}
          />
          <Divider />
          <Row
            icon="log-out"
            label="Sign out"
            destructive
            onPress={handleSignOut}
          />
          <Divider />
          <Row
            icon="trash"
            label="Delete account"
            destructive
            onPress={handleDeleteAccount}
          />
        </Card>

        <Text style={styles.versionText}>ORBII · v{APP_VERSION}</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function StatPill({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={pillStyles.wrap}>
      <Text style={[pillStyles.value, color ? { color } : null]}>{value}</Text>
      <Text style={pillStyles.label}>{label}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const pillStyles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-start',
    gap: 2,
  },
  value: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 16,
    color: colors.textPrimary,
  },
  label: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

const AVATAR = 72;

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 110,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  headerTitle: {
    ...typography.displaySmall,
    color: colors.textPrimary,
  },
  heroCard: {
    margin: spacing.lg,
    marginTop: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarWrap: {},
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.peachSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.peach,
  },
  avatarImg: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: colors.peach,
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.peachDeep,
  },
  premiumBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: radius.circle,
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
  },
  crown: {
    fontSize: 16,
    marginTop: -2,
  },
  phone: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  heroStats: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowsCard: {
    marginHorizontal: spacing.lg,
    padding: 0,
    overflow: 'hidden',
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  versionText: {
    ...typography.caption,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
