import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { TabNavigator } from './TabNavigator';
import { CountdownScreen } from '@/screens/SOS/CountdownScreen';
import { ActiveSOSScreen } from '@/screens/SOS/ActiveSOSScreen';
import { IncidentDetailScreen } from '@/screens/History/IncidentDetailScreen';
import { EmergencyContactsScreen } from '@/screens/Profile/EmergencyContactsScreen';
import { ContactFormScreen } from '@/screens/Profile/ContactFormScreen';
import { EditProfileScreen } from '@/screens/Profile/EditProfileScreen';
import { PremiumUpgradeScreen } from '@/screens/Premium/PremiumUpgradeScreen';
import { HelperVerificationScreen } from '@/screens/Helper/HelperVerificationScreen';
import { HelperDashboardScreen } from '@/screens/Helper/HelperDashboardScreen';
import { AcceptSOSScreen } from '@/screens/Helper/AcceptSOSScreen';
import { HelperNavigationScreen } from '@/screens/Helper/HelperNavigationScreen';
import { WithdrawScreen } from '@/screens/Helper/WithdrawScreen';
import { IdVerificationScreen } from '@/screens/Auth/IdVerificationScreen';
import { NotificationsScreen } from '@/screens/Notifications/NotificationsScreen';
import { SafeJourneyStartScreen } from '@/screens/SafeMode/SafeJourneyStartScreen';
import { SafeJourneyActiveScreen } from '@/screens/SafeMode/SafeJourneyActiveScreen';
import { CommunityAlertsScreen } from '@/screens/Community/CommunityAlertsScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { FriendsScreen } from '@/screens/Friends/FriendsScreen';
import { ChatThreadScreen } from '@/screens/Friends/ChatThreadScreen';
import { HistoryScreen } from '@/screens/History/HistoryScreen';
import { SupportChatScreen } from '@/screens/Support/SupportChatScreen';
import { AboutScreen } from '@/screens/About/AboutScreen';
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
        name="HelperVerification"
        component={HelperVerificationScreen}
        options={withHeader('Become a helper')}
      />
      <Stack.Screen
        name="HelperDashboard"
        component={HelperDashboardScreen}
        options={withHeader('Helper dashboard')}
      />
      <Stack.Screen
        name="AcceptSOS"
        component={AcceptSOSScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'fade',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="HelperNavigation"
        component={HelperNavigationScreen}
        options={{
          presentation: 'fullScreenModal',
          animation: 'slide_from_bottom',
          gestureEnabled: false,
        }}
      />
      <Stack.Screen
        name="Withdraw"
        component={WithdrawScreen}
        options={withHeader('Withdraw earnings')}
      />
      <Stack.Screen
        name="IdVerification"
        component={IdVerificationScreen}
        options={withHeader('Verify your identity')}
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
        name="Profile"
        component={ProfileScreen}
        options={withHeader('Profile')}
      />
      <Stack.Screen
        name="Friends"
        component={FriendsScreen}
        options={withHeader('Friends')}
      />
      <Stack.Screen
        name="ChatThread"
        component={ChatThreadScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="History"
        component={HistoryScreen}
        options={withHeader('SOS history')}
      />
      <Stack.Screen
        name="SupportChat"
        component={SupportChatScreen}
        options={{ headerShown: false, animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="About"
        component={AboutScreen}
        options={withHeader('About ORBII')}
      />
    </Stack.Navigator>
  );
}
