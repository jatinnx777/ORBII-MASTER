import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { CountdownScreen } from '@/screens/SOS/CountdownScreen';
import { ActiveSOSScreen } from '@/screens/SOS/ActiveSOSScreen';
import { HelperResponseScreen } from '@/screens/SOS/HelperResponseScreen';
import { IncidentDetailScreen } from '@/screens/History/IncidentDetailScreen';
import { EmergencyContactsScreen } from '@/screens/Profile/EmergencyContactsScreen';
import { SafetyReadinessScreen } from '@/screens/SafetyReadiness/SafetyReadinessScreen';
import { GeofencesScreen } from '@/screens/Geofence/GeofencesScreen';
import { RecordingsScreen } from '@/screens/Recordings/RecordingsScreen';
import { CommunityFeedScreen } from '@/screens/Community/CommunityFeedScreen';
import { CommunityProfileSetupScreen } from '@/screens/Community/CommunityProfileSetupScreen';
import { CommunityUserProfileScreen } from '@/screens/Community/CommunityUserProfileScreen';
import { ContactFormScreen } from '@/screens/Profile/ContactFormScreen';
import { EditProfileScreen } from '@/screens/Profile/EditProfileScreen';
import { PremiumUpgradeScreen } from '@/screens/Premium/PremiumUpgradeScreen';
import { NotificationsScreen } from '@/screens/Notifications/NotificationsScreen';
import { SafeJourneyStartScreen } from '@/screens/SafeMode/SafeJourneyStartScreen';
import { SafeJourneyActiveScreen } from '@/screens/SafeMode/SafeJourneyActiveScreen';
import { CommunityAlertsScreen } from '@/screens/Community/CommunityAlertsScreen';
import { HelperAlertScreen } from '@/screens/Community/HelperAlertScreen';
import { HelperNavigationScreen } from '@/screens/Community/HelperNavigationScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { CirclesScreen } from '@/screens/Circles/CirclesScreen';
import { HistoryScreen } from '@/screens/History/HistoryScreen';
import { AboutScreen } from '@/screens/About/AboutScreen';
import { GhostStartScreen } from '@/screens/Safety/Ghost/StartScreen';
import { GhostActiveScreen } from '@/screens/Safety/Ghost/ActiveScreen';
import { DeadmanStartScreen } from '@/screens/Safety/Deadman/StartScreen';
import { DeadmanActiveScreen } from '@/screens/Safety/Deadman/ActiveScreen';
import { OEMHelpScreen } from '@/screens/OEMHelp/OEMHelpScreen';
import { LanguageSelectorScreen } from '@/screens/Auth/LanguageSelectorScreen';
import { CircleDetailScreen } from '@/screens/Circles/CircleDetailScreen';
import { CircleCreateScreen } from '@/screens/Circles/CircleCreateScreen';
import { CircleInviteScreen } from '@/screens/Circles/CircleInviteScreen';
import { SafetyPinScreen } from '@/screens/Settings/SafetyPinScreen';
import { VoicePhrasesScreen } from '@/screens/Settings/VoicePhrasesScreen';
import { VoiceDebugScreen } from '@/screens/Debug/VoiceDebugScreen';
import { ResponderApplicationScreen } from '@/responder/ResponderApplicationScreen';
import { ResponderVerificationScreen } from '@/responder/ResponderVerificationScreen';
import { ResponderRecognitionScreen } from '@/responder/ResponderRecognitionScreen';
import { ResponderEarningsScreen } from '@/responder/ResponderEarningsScreen';
import { WalkWithMeScreen } from '@/screens/Safety/WalkWithMeScreen';
import { colors, fontFamilies } from '@/theme';
import type { AppStackParamList } from './types';

const Stack = createNativeStackNavigator<AppStackParamList>();

const withHeader = (title: string) => ({
  headerShown: true,
  title,
  headerTitleStyle: { fontFamily: fontFamilies.poppinsBold },
  headerTintColor: colors.textPrimary,
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
});

export function AppNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        // Smooth slide-over between pages (SOS/emergency screens override this
        // with their own fade / slide-from-bottom below).
        animation: 'slide_from_right',
        animationDuration: 280,
      }}
    >
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen
        name="SOSCountdown"
        component={CountdownScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="ActiveSOS"
        component={ActiveSOSScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="HelperResponse"
        component={HelperResponseScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="IncidentDetail"
        component={IncidentDetailScreen}
        options={withHeader('Incident details')}
      />
      <Stack.Screen
        name="EmergencyContacts"
        component={EmergencyContactsScreen}
        options={withHeader('Emergency contacts')}
      />
      <Stack.Screen
        name="SafetyReadiness"
        component={SafetyReadinessScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Geofences"
        component={GeofencesScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Recordings"
        component={RecordingsScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CommunityFeed"
        component={CommunityFeedScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CommunityProfileSetup"
        component={CommunityProfileSetupScreen}
        options={withHeader('Community profile')}
      />
      <Stack.Screen
        name="CommunityUserProfile"
        component={CommunityUserProfileScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ContactForm"
        component={ContactFormScreen}
        options={withHeader('Add contact')}
      />
      <Stack.Screen
        name="EditProfile"
        component={EditProfileScreen}
        options={withHeader('Edit profile')}
      />
      <Stack.Screen
        name="PremiumUpgrade"
        component={PremiumUpgradeScreen}
        options={withHeader('ORBII Premium')}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={withHeader('Notifications')}
      />
      <Stack.Screen
        name="SafeJourneyStart"
        component={SafeJourneyStartScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="SafeJourneyActive"
        component={SafeJourneyActiveScreen}
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="CommunityAlerts"
        component={CommunityAlertsScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="HelperAlert"
        component={HelperAlertScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="HelperNavigation"
        component={HelperNavigationScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom', gestureEnabled: false }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Circles"
        component={CirclesScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={withHeader('SOS history')}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={withHeader('About ORBII')}
      />
      <Stack.Screen
        name="GhostStart"
        component={GhostStartScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="GhostActive"
        component={GhostActiveScreen}
        options={{
          headerShown: false,
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="DeadmanStart"
        component={DeadmanStartScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="DeadmanActive"
        component={DeadmanActiveScreen}
        options={{
          headerShown: false,
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="OEMHelp"
        component={OEMHelpScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="LanguageSelectorApp"
        component={LanguageSelectorScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CircleDetail"
        component={CircleDetailScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="CircleCreate"
        component={CircleCreateScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="CircleInvite"
        component={CircleInviteScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="SafetyPin"
        component={SafetyPinScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="VoicePhrases"
        component={VoicePhrasesScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="VoiceDebug"
        component={VoiceDebugScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      {/* Responder onboarding (Missions itself is a role-gated tab) */}
      <Stack.Screen
        name="ResponderApplication"
        component={ResponderApplicationScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ResponderVerification"
        component={ResponderVerificationScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ResponderRecognition"
        component={ResponderRecognitionScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ResponderEarnings"
        component={ResponderEarningsScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="WalkWithMe"
        component={WalkWithMeScreen}
        options={{ headerShown: false, animation: 'slide_from_bottom' }}
      />
    </Stack.Navigator>
  );
}
