import React, { useEffect, useState } from 'react';
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
import {
  isAccessibilityEnabled,
  isNativeHardwareAvailable,
  openAccessibilitySettings,
} from '@/services/hardware-sos';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
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
  hardwareSOSToggled,
  pushEnabledSet,
} from '@/redux/slices/appSlice';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { requestNotificationPermission } from '@/services/notifications';
import { APP_VERSION, COPYRIGHT_LINE } from '@/services/app-info';
import type { AppStackParamList, TabParamList } from '@/navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  NativeStackNavigationProp<AppStackParamList>
>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const alertVibration = useAppSelector((s) => s.app.alertVibration);
  const hardwareSOS = useAppSelector((s) => s.app.hardwareSOS);
  const push = useAppSelector((s) => s.app.pushEnabled);

  const [accessibilityOn, setAccessibilityOn] = useState(false);
  const nativeAvailable = isNativeHardwareAvailable();
  // Refresh the accessibility flag when the screen mounts and whenever
  // hardwareSOS toggles — covers the case where the user just toggled
  // on, opened Settings, came back, and we want to know if they enabled.
  useEffect(() => {
    if (!nativeAvailable) return;
    let cancelled = false;
    isAccessibilityEnabled().then((on) => {
      if (!cancelled) setAccessibilityOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, [nativeAvailable, hardwareSOS]);

  const handleToggleHardware = (next: boolean) => {
    dispatch(hardwareSOSToggled(next));
    if (next && nativeAvailable && !accessibilityOn) {
      sheet.confirm({
        title: 'Enable global hardware SOS',
        body:
          'For triple-press to fire SOS even when the screen is off or ORBII is closed, enable the ORBII Accessibility Service. We only listen for volume key events — never your screen content.',
        confirmLabel: 'Open Accessibility',
        cancelLabel: 'Skip for now',
        icon: 'shield-checkmark',
        onConfirm: () => {
          openAccessibilitySettings();
        },
      });
    }
  };
  const sheet = useBrandSheet();
  const friendsCount = profile?.friends?.length ?? 0;
  const contactsCount = profile?.emergencyContacts?.length ?? 0;

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
        <Text style={styles.title}>Settings</Text>

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
            icon="hardware-chip-outline"
            label="Hardware button SOS"
            value={
              hardwareSOS
                ? nativeAvailable && accessibilityOn
                  ? 'Triple-press volume — works screen-off'
                  : 'Triple-press volume — works while ORBII is open'
                : 'Off — only the SOS button fires alerts'
            }
            right={
              <Switch
                value={hardwareSOS}
                onValueChange={handleToggleHardware}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={hardwareSOS ? colors.brandDeep : colors.background}
              />
            }
          />
          {hardwareSOS && nativeAvailable && !accessibilityOn ? (
            <Pressable
              onPress={() => openAccessibilitySettings()}
              style={({ pressed }) => [
                styles.upgradeBanner,
                pressed && styles.bannerPressed,
              ]}
              accessibilityRole="button"
            >
              <Ionicons
                name="sparkles"
                size={14}
                color={colors.brandDeep}
              />
              <Text style={styles.upgradeBannerText}>
                Enable ORBII in Accessibility for screen-off coverage
              </Text>
              <Ionicons
                name="chevron-forward"
                size={14}
                color={colors.textSecondary}
              />
            </Pressable>
          ) : null}
          <Divider />
          <Row
            icon="mic-outline"
            label="Background Voice SOS"
            value="Always-on wake word — Picovoice setup needed"
            onPress={() => navigation.navigate('VoiceSetup')}
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

        <SectionHeader title="Circle" />
        <Card style={styles.rowsCard}>
          <Row
            icon="people-circle"
            label="Manage your circle"
            value={`${friendsCount} ${friendsCount === 1 ? 'friend' : 'friends'} in your circle`}
            onPress={() => navigation.navigate('Friends')}
          />
          <Divider />
          <Row
            icon="person-add"
            label="Add people to circle"
            value="Search by username or name"
            onPress={() => navigation.navigate('Friends')}
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
            icon="chatbubbles"
            label="Chat with support"
            value="ORBII Assistant — instant replies"
            onPress={() => navigation.navigate('SupportChat')}
          />
          <Divider />
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
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 28,
    color: colors.textPrimary,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
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
