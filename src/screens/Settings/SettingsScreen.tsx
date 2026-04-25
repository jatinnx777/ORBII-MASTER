import React from 'react';
import {
  Alert,
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
} from '@/components/common';
import { colors, fontFamilies, spacing } from '@/theme';
import { useAppDispatch, useAppSelector } from '@/redux/store';
import {
  alertVibrationToggled,
  backgroundVoiceToggled,
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
  const push = useAppSelector((s) => s.app.pushEnabled);

  const handleVoice = (next: boolean) => {
    if (next && !profile?.isPremium) {
      Alert.alert(
        'Premium feature',
        'Voice-activated SOS is a Premium feature. Upgrade to unlock.',
        [
          { text: 'Later', style: 'cancel' },
          {
            text: 'Upgrade',
            onPress: () => navigation.navigate('PremiumUpgrade'),
          },
        ],
      );
      return;
    }
    dispatch(voiceDetectionToggled(next));
  };

  const handleBackgroundVoice = (next: boolean) => {
    if (next) {
      Alert.alert(
        'Run ORBII in the background?',
        'ORBII will keep listening for "help", "bachao", or "madad" while the app is closed. A persistent notification stays in the tray so Android doesn\'t kill the listener. This uses extra battery.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn on',
            onPress: () => dispatch(backgroundVoiceToggled(true)),
          },
        ],
      );
      return;
    }
    dispatch(backgroundVoiceToggled(false));
  };

  const handlePush = async (next: boolean) => {
    if (next) {
      const ok = await requestNotificationPermission();
      if (!ok) {
        Alert.alert(
          'Permission denied',
          'Enable notifications in system settings to receive SOS alerts.',
        );
        return;
      }
    }
    dispatch(pushEnabledSet(next));
  };

  const handleTestSOS = () => {
    Alert.alert(
      'Practice SOS?',
      'Runs the full SOS flow without sending real alerts. The incident shows up in your history tagged "PRACTICE".',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start practice',
          onPress: () => navigation.navigate('SOSCountdown', { test: true }),
        },
      ],
    );
  };

  const handleTestNotif = async () => {
    const ok = await requestNotificationPermission();
    if (!ok) {
      Alert.alert('Enable notifications first');
      return;
    }
    fireLocalNotification(
      'Test alert',
      'If you see this, push notifications work on your device.',
    );
  };

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
