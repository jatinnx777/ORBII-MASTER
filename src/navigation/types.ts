import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Login: undefined;
  OTP: { phone: string };
  ProfileSetup: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type TabParamList = {
  Home: undefined;
  Helpers: undefined;
  History: undefined;
  Profile: undefined;
  Settings: undefined;
};

export type AppStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  SOSCountdown: undefined;
  ActiveSOS: undefined;
  IncidentDetail: { recordId: string };
  EmergencyContacts: undefined;
  ContactForm: { contactId?: string };
  EditProfile: undefined;
  PremiumUpgrade: undefined;
  HelperVerification: undefined;
  HelperDashboard: undefined;
  IdVerification: undefined;
  Notifications: undefined;
  AcceptSOS: undefined;
  HelperNavigation: undefined;
  Withdraw: undefined;
  SafeJourneyStart: undefined;
  SafeJourneyActive: undefined;
  CommunityAlerts: undefined;
};

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
