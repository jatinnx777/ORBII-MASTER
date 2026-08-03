import React, { useEffect, useState } from 'react';
import { ContactMatchService } from '@/services/rewards';
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
} from '@/redux/slices/appSlice';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { clearPin } from '@/services/safety-pin';
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

  const [contactMatch, setContactMatch] = useState(false);
  useEffect(() => {
    ContactMatchService.isEnabled().then(setContactMatch);
  }, []);
  const handleContactMatch = async (next: boolean) => {
    if (next) {
      const n = await ContactMatchService.setEnabled(true);
      if (n < 0) {
        sheet.notify({
          title: 'Contact access needed',
          body: 'Allow contacts to turn on private fraud protection. Your numbers are hashed on your phone and never uploaded.',
          tone: 'warning',
        });
        return;
      }
      setContactMatch(true);
      sheet.notify({
        title: 'Private fraud protection on',
        body: `${n} contacts matched privately. Raw numbers never leave your phone.`,
        tone: 'success',
      });
    } else {
      await ContactMatchService.setEnabled(false);
      setContactMatch(false);
    }
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
        // Device-local PIN: clear it so the next user sets their own.
        await clearPin().catch(() => undefined);
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
            tint="peach"
            label="Edit profile"
            value={profile?.username ? `@${profile.username}` : 'Set up your handle'}
            onPress={() => navigation.navigate('EditProfile')}
          />
          <Divider />
          <Row
            icon="people"
            tint="coral"
            label="Emergency contacts"
            value={`${contactsCount} ${contactsCount === 1 ? 'contact' : 'contacts'}`}
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
        </Card>

        <SectionHeader title="Emergency triggers" />
        <Card style={styles.rowsCard}>
          <Row
            icon="mic-outline"
            tint="coral"
            label="Voice SOS"
            value={'Shout "help, help" to trigger an SOS, hands-free'}
            onPress={() => navigation.navigate('VoicePhrases')}
          />
        </Card>

        <SectionHeader title="Privacy" />
        <Card style={styles.rowsCard}>
          <Row
            icon="notifications"
            tint="sage"
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
            tint="sage"
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
            tint="sage"
            label="Location sharing"
            value="Always while app is open · only your circle sees you"
            onPress={() => Linking.openSettings().catch(() => undefined)}
          />
          <Divider />
          <Row
            icon="lock-closed"
            tint="sage"
            label="Private contact matching"
            value={
              contactMatch
                ? 'On · contacts hashed on your phone, never uploaded'
                : 'Off · helps block reward fraud (optional)'
            }
            right={
              <Switch
                value={contactMatch}
                onValueChange={handleContactMatch}
                trackColor={{ true: colors.brand, false: colors.border }}
                thumbColor={contactMatch ? colors.brandDeep : colors.background}
              />
            }
          />
        </Card>

        <SectionHeader title="Community" />
        <Card style={styles.rowsCard}>
          <Row
            icon="notifications-outline"
            tint="gold"
            label="Notifications"
            value="Alerts, circle requests, and updates"
            onPress={() => navigation.navigate('Notifications')}
          />
          <Divider />
          <Row
            icon="people-circle"
            tint="peach"
            label="Manage circles"
            value={`${circlesCount} ${circlesCount === 1 ? 'circle' : 'circles'}`}
            onPress={() => navigation.navigate('Circles')}
          />
          <Divider />
          {isResponder ? (
            <Row
              icon="ribbon"
              tint="sage"
            label="Verified helper"
              value="You're an ORBII responder. Open your Missions dashboard."
              onPress={() => navigation.navigate('Missions')}
            />
          ) : (
            <Row
              icon="shield-checkmark-outline"
              tint="sage"
            label="Register as a verified helper"
              value="Upload your Aadhaar, PAN and a selfie to get verified and help people nearby"
              onPress={() => navigation.navigate('ResponderApplication')}
            />
          )}
        </Card>

        <SectionHeader title="Preferences" />
        <Card style={styles.rowsCard}>
          <Row
            icon="language"
            tint="gold"
            label="Language"
            value="English, Hindi, Punjabi, Tamil, Bengali"
            onPress={() => navigation.navigate('LanguageSelectorApp')}
          />
        </Card>

        <SectionHeader title="Help" />
        <Card style={styles.rowsCard}>
          <Row
            icon="information-circle"
            tint="neutral"
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
