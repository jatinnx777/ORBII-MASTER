import React from 'react';
import {
  Alert,
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
} from '@/components/common';
import { colors, fontFamilies, radius, spacing, typography } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function ProfileScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const history = useAppSelector((s) => s.history.records);
  const helper = useAppSelector((s) => s.helper);

  if (!profile) return null;

  const initial = (profile.name || profile.email || 'O').charAt(0).toUpperCase();
  const sosCount = history.length;

  const handleSignOut = () => {
    Alert.alert('Sign out?', 'You can sign back in with your Google account.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await signOutFromGoogle();
          dispatch(signedOut());
        },
      },
    ]);
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
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
            <Text style={styles.name}>{profile.name ?? 'ORBII user'}</Text>
            <Text style={styles.phone}>{profile.email || profile.phone || ''}</Text>
            <View style={styles.heroStats}>
              <StatPill label="SOS sent" value={String(sosCount)} />
              <StatPill
                label="Contacts"
                value={String(profile.emergencyContacts.length)}
              />
              {helper.mode ? (
                <StatPill label="Status" value="Online" color={colors.success} />
              ) : null}
            </View>
          </View>
        </Card>

        <SectionHeader title="Safety" />
        <Card style={styles.rowsCard}>
          <Row
            icon="people"
            label="Emergency contacts"
            value={
              profile.emergencyContacts.length === 0
                ? 'Add trusted people to notify in an emergency'
                : `${profile.emergencyContacts.length} added`
            }
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
          <Divider />
          <Row
            icon="ribbon"
            label="ORBII plans"
            value="See what's in Free, Premium and Premium Plus"
            onPress={() => navigation.navigate('PremiumUpgrade')}
          />
          <Divider />
          <Row
            icon="time"
            label="SOS history"
            value={`${sosCount} incident${sosCount === 1 ? '' : 's'}`}
            onPress={() => navigation.navigate('History')}
          />
        </Card>

        <SectionHeader title="Helper" />
        <Card style={styles.rowsCard}>
          {helper.verification === 'verified' ? (
            <>
              <Row
                icon="shield-checkmark"
                iconColor={colors.success}
                label="Helper dashboard"
                value={`${helper.totalJobs} jobs · ₹${helper.pendingBalance} pending`}
                onPress={() => navigation.navigate('HelperDashboard')}
              />
              <Divider />
              <Row
                icon="cash"
                label="Earnings & withdraw"
                onPress={() => navigation.navigate('Withdraw')}
              />
            </>
          ) : (
            <Row
              icon="hand-left"
              label="Become a helper"
              value="Earn ₹100 per SOS you respond to"
              onPress={() => navigation.navigate('HelperVerification')}
            />
          )}
        </Card>

        <SectionHeader title="Account" />
        <Card style={styles.rowsCard}>
          <Row
            icon="person-circle"
            label="Edit profile"
            onPress={() => navigation.navigate('EditProfile')}
          />
          <Divider />
          <Row
            icon="settings"
            label="Settings"
            onPress={() => navigation.navigate('Tabs', { screen: 'Settings' })}
          />
          <Divider />
          <Row
            icon="log-out"
            label="Sign out"
            destructive
            onPress={handleSignOut}
          />
        </Card>

        <Text style={styles.versionText}>ORBII · v0.1.0 · demo build</Text>
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
    paddingBottom: spacing.xl,
  },
  heroCard: {
    margin: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatarWrap: {},
  avatar: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarImg: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: AVATAR / 2,
    borderWidth: 2,
    borderColor: colors.primary,
  },
  avatarInitial: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.primary,
  },
  premiumBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: radius.circle,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  name: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 20,
    color: colors.textPrimary,
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
