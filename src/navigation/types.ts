import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  ProfileSetup: undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type TabParamList = {
  Home: undefined;
  Safety: undefined;
  Membership: undefined;
  Settings: undefined;
};

export type AppStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  SOSCountdown: { instant?: boolean; test?: boolean } | undefined;
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
  Profile: undefined;
  Friends: undefined;
  ChatThread: { username: string };
  History: undefined;
  SupportChat: undefined;
  About: undefined;
};

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
