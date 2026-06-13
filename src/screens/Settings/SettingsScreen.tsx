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
  helperModeSet,
  pushEnabledSet,
  shakeSOSToggled,
} from '@/redux/slices/appSlice';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { startHelperMode, stopHelperMode } from '@/services/helper-mode';
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
  const shakeSOS = useAppSelector((s) => s.app.shakeSOS);

  const helperMode = useAppSelector((s) => s.app.helperMode);
  const sheet = useBrandSheet();
  const contactsCount = profile?.emergencyContacts?.length ?? 0;
  const circlesCount = useAppSelector((s) => s.circles.circles.length);

  const handleHelperMode = (next: boolean) => {
    dispatch(helperModeSet(next));
    if (next) void startHelperMode();
    else void stopHelperMode();
  };

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
            icon="phone-portrait-outline"
            label="Shake to SOS"
            value={
              shakeSOS
                ? 'Three hard shakes fires the countdown'
                : 'Off — only the SOS button fires alerts'
            }
            right={
              <Switch
                value={shakeSOS}
                onValueChange={(v) => {
                  dispatch(shakeSOSToggled(v));
                }}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={shakeSOS ? colors.brandDeep : colors.background}
              />
            }
          />
          <Divider />
          <Row
            icon="mic-outline"
            label="Voice SOS phrases"
            value="Set your own secret phrases to trigger an SOS"
            onPress={() => navigation.navigate('VoicePhrases')}
          />
          <Divider />
          <Row
            icon="shield-checkmark-outline"
            label="Safety PIN"
            value="Required to cancel an active SOS"
            onPress={() => navigation.navigate('SafetyPin')}
          />
          <Divider />
          <Row
            icon="bug-outline"
            label="Practice SOS"
            value="Walk through the full countdown — nothing is sent"
            onPress={() => navigation.navigate('SOSCountdown', { test: true })}
          />
          <Divider />
          <Row
            icon="hand-left-outline"
            label="Background reliability"
            value="OEM permissions, autostart, battery — walk-through"
            onPress={() => navigation.navigate('OEMHelp')}
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
                : 'Off — you won\'t be notified'
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
                : 'Off — no buzz on incoming alerts'
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
            icon="people-circle"
            label="Manage circles"
            value={`${circlesCount} ${circlesCount === 1 ? 'circle' : 'circles'}`}
            onPress={() => navigation.navigate('Circles')}
          />
          <Divider />
          <Row
            icon="hand-right"
            label="Helper Mode"
            value={
              helperMode
                ? "You're available to help people nearby"
                : 'Turn on to help people near you in an emergency'
            }
            right={
              <Switch
                value={helperMode}
                onValueChange={handleHelperMode}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={helperMode ? colors.brandDeep : colors.background}
              />
            }
          />
        </Card>

        <SectionHeader title="Preferences" />
        <Card style={styles.rowsCard}>
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
            icon="ribbon"
            label="ORBII plans"
            onPress={() => navigation.navigate('PremiumUpgrade')}
          />
          <Divider />
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
    fontSize: 28,
    color: colors.textPrimary,
    letterSpacing: -0.4,
  },
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
