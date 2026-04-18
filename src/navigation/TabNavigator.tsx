import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { HomeScreen } from '@/screens/Home/HomeScreen';
import { HelpersTabScreen } from '@/screens/Helpers/HelpersTabScreen';
import { HistoryScreen } from '@/screens/History/HistoryScreen';
import { ProfileScreen } from '@/screens/Profile/ProfileScreen';
import { SettingsScreen } from '@/screens/Settings/SettingsScreen';
import { colors, fontFamilies } from '@/theme';
import type { TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();

type IoniconsName = React.ComponentProps<typeof Ionicons>['name'];

const icons: Record<
  keyof TabParamList,
  { active: IoniconsName; inactive: IoniconsName }
> = {
  Home: { active: 'home', inactive: 'home-outline' },
  Helpers: { active: 'people', inactive: 'people-outline' },
  History: { active: 'time', inactive: 'time-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
  Settings: { active: 'settings', inactive: 'settings-outline' },
};

export function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarIcon: ({ focused, color, size }) => {
          const name = focused
            ? icons[route.name].active
            : icons[route.name].inactive;
          return <Ionicons name={name} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Helpers" component={HelpersTabScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.background,
    borderTopColor: colors.border,
    height: Platform.OS === 'ios' ? 88 : 64,
    paddingTop: 6,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
  },
  tabLabel: {
    fontFamily: fontFamilies.interMedium,
    fontSize: 11,
  },
});
