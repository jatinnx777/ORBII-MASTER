import React from 'react';
import {
  Linking,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
import { colors, fontFamilies, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  alertVibrationToggled,
  backgroundVoiceToggled,
  crashDetectionToggled,
  pushEnabledSet,
  voiceDetectionToggled,
} from '@/redux/slices/appSlice';
import { signedOut } from '@/redux/slices/userSlice';
import { signOutFromGoogle } from '@/services/auth';
import { trackEvent } from '@/services/analytics';
import {
  fireLocalNotification,
  requestNotificationPermission,
} from '@/services/notifications';
import type { AppStackParamList, TabParamList } from '@/navigation/types';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, 'Settings'>,
  NativeStackNavigationProp<AppStackParamList>
>;

export function SettingsScreen() {
  const navigation = useNavigation<Nav>();
  const dispatch = useAppDispatch();
  const profile = useAppSelector((s) => s.user.profile);
  const voice = useAppSelector((s) => s.app.voiceDetection);
  const backgroundVoice = useAppSelector((s) => s.app.backgroundVoice);
  const alertVibration = useAppSelector((s) => s.app.alertVibration);
  const crashDetection = useAppSelector((s) => s.app.crashDetection);
  const push = useAppSelector((s) => s.app.pushEnabled);
  const sheet = useBrandSheet();

  const handleVoice = (next: boolean) => {
    if (next && !profile?.isPremium) {
      sheet.confirm({
        title: 'Premium feature',
        body: 'Voice-activated SOS is a Premium feature. Upgrade to unlock.',
        cancelLabel: 'Later',
        confirmLabel: 'See plans',
        icon: 'ribbon',
        onConfirm: () => navigation.navigate('PremiumUpgrade'),
      });
      return;
    }
    dispatch(voiceDetectionToggled(next));
  };

  const handleBackgroundVoice = (next: boolean) => {
    if (next) {
      sheet.confirm({
        title: 'Run ORBII in the background?',
        body: 'ORBII will keep listening for "help", "bachao", or "madad" while the app is closed. A persistent notification stays in the tray so Android does not kill the listener. Uses extra battery.',
        confirmLabel: 'Turn on',
        icon: 'mic',
        onConfirm: () => dispatch(backgroundVoiceToggled(true)),
      });
      return;
    }
    dispatch(backgroundVoiceToggled(false));
  };

  const handlePush = async (next: boolean) => {
    if (next) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        sheet.notify({
          title: 'Permission denied',
          body: 'Enable notifications in system settings to receive SOS alerts.',
          tone: 'warning',
        });
        return;
      }
    }
    dispatch(pushEnabledSet(next));
  };

  const handleTestSOS = () => {
    sheet.confirm({
      title: 'Practice SOS?',
      body: 'Runs the full SOS flow without sending real alerts. The incident shows up in your history tagged "PRACTICE".',
      confirmLabel: 'Start practice',
      icon: 'flask',
      onConfirm: () => navigation.navigate('SOSCountdown', { test: true }),
    });
  };

  const handleTestNotif = async () => {
    const ok = await requestNotificationPermission();
    if (!ok) {
      sheet.notify({
        title: 'Enable notifications first',
        body: 'Notifications are turned off in system settings.',
        tone: 'warning',
      });
      return;
    }
    fireLocalNotification(
      'Test alert',
      'If you see this, push notifications work on your device.',
    );
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

        <SectionHeader title="SOS" />
        <Card style={styles.rowsCard}>
          <Row
            icon="mic"
            label="Voice detection"
            value={
              profile?.isPremium
                ? 'Listens for "help" keyword'
                : 'Premium feature'
            }
            right={
              <Switch
                value={voice}
                onValueChange={handleVoice}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            }
          />
          <Divider />
          <Row
            icon="radio"
            label="Background Voice SOS"
            value={
              backgroundVoice
                ? 'Listening even when app is closed'
                : 'Off, only listens with app open'
            }
            right={
              <Switch
                value={backgroundVoice}
                onValueChange={handleBackgroundVoice}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            }
          />
          <Divider />
          <Row
            icon="car-sport"
            label="Crash detection"
            value={
              crashDetection
                ? 'Auto-fires SOS on detected impact'
                : 'Off. Sensor watch for sudden 3.5g jolts'
            }
            right={
              <Switch
                value={crashDetection}
                onValueChange={(v) => {
                  dispatch(crashDetectionToggled(v));
                }}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            }
          />
          <Divider />
          <Row
            icon="play-circle"
            label="Trigger test SOS"
            value="Same countdown flow, no alerts sent"
            onPress={handleTestSOS}
          />
          <Divider />
          <Row
            icon="people"
            label="Emergency contacts"
            value={`${profile?.emergencyContacts.length ?? 0} added`}
            onPress={() => navigation.navigate('EmergencyContacts')}
          />
        </Card>

        <SectionHeader title="Notifications" />
        <Card style={styles.rowsCard}>
          <Row
            icon="notifications"
            label="Push notifications"
            value="SOS, helper jobs, arrivals"
            right={
              <Switch
                value={push}
                onValueChange={handlePush}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            }
          />
          <Divider />
          <Row
            icon="phone-portrait"
            label="Vibrate on nearby SOS"
            value={
              alertVibration
                ? 'Hard buzz when help is needed within 2 km'
                : 'Off, no buzz on incoming alerts'
            }
            right={
              <Switch
                value={alertVibration}
                onValueChange={(v) => {
                  dispatch(alertVibrationToggled(v));
                }}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            }
          />
          <Divider />
          <Row
            icon="pulse"
            label="Send test notification"
            onPress={handleTestNotif}
          />
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

        <SectionHeader title="About" />
        <Card style={styles.rowsCard}>
          <Row
            icon="mail"
            label="Contact support"
            value="hello@orbii.app"
            onPress={() => Linking.openURL('mailto:hello@orbii.app')}
          />
          <Divider />
          <Row
            icon="document-text"
            label="Privacy policy"
            onPress={() => Linking.openURL('https://orbii.app/privacy')}
          />
          <Divider />
          <Row icon="information-circle" label="Version" value="0.1.0 · demo" />
        </Card>
      </ScrollView>
    </ScreenContainer>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: spacing.xl,
  },
  title: {
    fontFamily: fontFamilies.poppinsBold,
    fontSize: 24,
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginHorizontal: spacing.lg,
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
});
