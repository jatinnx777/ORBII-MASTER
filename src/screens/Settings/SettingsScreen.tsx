import React from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
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
import { colors, fontFamilies, radius, shadows, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  alertVibrationToggled,
  pushEnabledSet,
  accentSet,
} from '@/redux/slices/appSlice';
import { ACCENT_LIST, accentOf } from '@/theme/accents';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { useIsResponder } from '@/services/roles';
import { requestNotificationPermission } from '@/services/notifications';
import { APP_VERSION, COPYRIGHT_LINE } from '@/services/app-info';
import type { AppStackParamList } from '@/navigation/types';

type Nav = NativeStackNavigationProp<AppStackParamList>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const alertVibration = useAppSelector((s) => s.app.alertVibration);
  const push = useAppSelector((s) => s.app.pushEnabled);
  const accent = useAppSelector((s) => s.app.accent);
  const isResponder = useIsResponder();

  const sheet = useBrandSheet();
  const contactsCount = profile?.emergencyContacts?.length ?? 0;
  const circlesCount = useAppSelector((s) => s.circles.circles.length);

  const handlePush = async (next: boolean) => {
    if (next) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        sheet.notify({
          title: 'Permission denied',
          body: 'Enable notifications in system settings to receive alerts.',
          tone: 'warning',
        });
        return;
      }
    }
    dispatch(pushEnabledSet(next));
  };

  const handleSignOut = () => {
    sheet.confirm({
      title: 'Sign out?',
      body: 'You can sign back in anytime. Your local profile and history will be cleared from this device.',
      destructive: true,
      confirmLabel: 'Sign out',
      icon: 'log-out',
      onConfirm: async () => {
        await signOutFromGoogle();
        dispatch(signedOut());
      },
    });
  };

  return (
    <ScreenContainer padded={false} scroll={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>Settings</Text>
        </View>

        <SectionHeader title="Profile" />
        <Card style={styles.rowsCard}>
          <Row
            icon="person-circle"
            label="Edit profile"
            value={profile?.username ? `@${profile.username}` : 'Set up your handle'}
            onPress={() => navigation.navigate('EditProfile')}
          />
          <Divider />
          <Row
            icon="people"
            label="Emergency contacts"
            value={`${contactsCount} ${contactsCount === 1 ? 'contact' : 'contacts'}`}
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
        </Card>

        <SectionHeader title="Emergency triggers" />
        <Card style={styles.rowsCard}>
          <Row
            icon="mic-outline"
            label="Voice SOS phrases"
            value="Set your own secret phrases to trigger an SOS"
            onPress={() => navigation.navigate('VoicePhrases')}
          />
        </Card>

        <SectionHeader title="Privacy" />
        <Card style={styles.rowsCard}>
          <Row
            icon="notifications"
            label="Smart notifications"
            value={
              push
                ? 'Push for SOS, helpers, and circle activity'
                : 'Off. You won\'t be notified'
            }
            right={
              <Switch
                value={push}
                onValueChange={handlePush}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={push ? colors.brandDeep : colors.background}
              />
            }
          />
          <Divider />
          <Row
            icon="phone-portrait"
            label="Vibrate on nearby alerts"
            value={
              alertVibration
                ? 'Buzz when help is needed within 2 km'
                : 'Off. No buzz on incoming alerts'
            }
            right={
              <Switch
                value={alertVibration}
                onValueChange={(v) => {
                  dispatch(alertVibrationToggled(v));
                }}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={alertVibration ? colors.brandDeep : colors.background}
              />
            }
          />
          <Divider />
          <Row
            icon="location"
            label="Location sharing"
            value="Always while app is open · only your circle sees you"
            onPress={() => Linking.openSettings().catch(() => undefined)}
          />
        </Card>

        <SectionHeader title="Community" />
        <Card style={styles.rowsCard}>
          <Row
            icon="notifications-outline"
            label="Notifications"
            value="Alerts, circle requests, and updates"
            onPress={() => navigation.navigate('Notifications')}
          />
          <Divider />
          <Row
            icon="people-circle"
            label="Manage circles"
            value={`${circlesCount} ${circlesCount === 1 ? 'circle' : 'circles'}`}
            onPress={() => navigation.navigate('Circles')}
          />
          <Divider />
          {isResponder ? (
            <Row
              icon="ribbon"
              label="Verified helper"
              value="You're an ORBII responder. Open your Missions dashboard."
              onPress={() => navigation.navigate('Tabs', { screen: 'Missions' })}
            />
          ) : (
            <Row
              icon="shield-checkmark-outline"
              label="Register as a verified helper"
              value="Upload your Aadhaar, PAN and a selfie to get verified and help people nearby"
              onPress={() => navigation.navigate('ResponderApplication')}
            />
          )}
        </Card>

        <SectionHeader title="Preferences" />
        <Card style={styles.rowsCard}>
          <View style={styles.accentRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accentLabel}>App accent</Text>
              <Text style={styles.accentHint}>Make ORBII feel like yours</Text>
            </View>
            <View style={styles.accentDots}>
              {ACCENT_LIST.map((a) => {
                const selected = accentOf(accent).id === a.id;
                return (
                  <Pressable
                    key={a.id}
                    onPress={() => dispatch(accentSet(a.id))}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={`${a.label} accent`}
                    style={[
                      styles.accentDot,
                      { backgroundColor: a.soft, borderColor: a.deep },
                      selected && styles.accentDotOn,
                    ]}
                  >
                    {selected ? (
                      <Ionicons name="checkmark" size={13} color={a.deep} />
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Divider />
          <Row
            icon="language"
            label="Language"
            value="English, Hindi, Punjabi, Tamil, Bengali"
            onPress={() => navigation.navigate('LanguageSelectorApp')}
          />
        </Card>

        <SectionHeader title="Help" />
        <Card style={styles.rowsCard}>
          <Row
            icon="information-circle"
            label="About ORBII"
            value="What we do, who we are"
            onPress={() => navigation.navigate('About')}
          />
        </Card>

        <SectionHeader title="Account" />
        <Card style={styles.rowsCard}>
          <Row
            icon="log-out"
            label="Sign out"
            destructive
            onPress={handleSignOut}
          />
        </Card>

        <View style={styles.footer}>
          <Text style={styles.versionText}>Version {APP_VERSION}</Text>
          <Text style={styles.copyrightText}>{COPYRIGHT_LINE}</Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 120,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.icon,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 34,
    lineHeight: 40,
    color: colors.textPrimary,
    letterSpacing: -0.5,
  },
  soonPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.goldSoft,
  },
  soonText: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 10,
    color: colors.goldDeep,
    letterSpacing: 0.4,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  accentLabel: { fontFamily: fontFamilies.poppinsSemiBold, fontSize: 15, color: colors.textPrimary },
  accentHint: { fontFamily: fontFamilies.interRegular, fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  accentDots: { flexDirection: 'row', gap: 10 },
  accentDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accentDotOn: { borderWidth: 2.5 },
  rowsCard: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 0,
    overflow: 'hidden',
    ...shadows.card,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: 56,
  },
  upgradeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
    borderWidth: 1,
    borderColor: colors.brandMid,
  },
  bannerPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.99 }],
  },
  upgradeBannerText: {
    flex: 1,
    fontFamily: fontFamilies.poppinsSemiBold,
    fontSize: 12,
    color: colors.brandDeep,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: 4,
  },
  versionText: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 12,
    color: colors.textMuted,
  },
  copyrightText: {
    fontFamily: fontFamilies.interRegular,
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 0.2,
  },
});
