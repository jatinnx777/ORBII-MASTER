import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  PhoneSignIn: undefined;
  PhoneVerify: { phone: string };
  LanguageSelector: undefined;
  ProfileSetup: undefined;
  // Note: IdVerification removed alongside the helper system cut.
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type TabParamList = {
  Home: undefined;
  Safety: undefined;
  Membership: undefined;
  Profile: undefined;
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
  Notifications: undefined;
  SafeJourneyStart: undefined;
  // requirePinToEnd: surface the PIN prompt the moment this screen
  // mounts. Set by the lock-screen "I'm safe" action when the user has
  // a safety PIN configured.
  SafeJourneyActive: { requirePinToEnd?: boolean } | undefined;
  CommunityAlerts: undefined;
  // Settings + Circles are now stack destinations (reached via the Home
  // gear / helpers row), not tabs — the tab bar is Home/Safety/Plans/Profile.
  Settings: undefined;
  Circles: undefined;
  Friends: undefined;
  History: undefined;
  About: undefined;
  GhostStart: undefined;
  GhostActive: undefined;
  DeadmanStart: undefined;
  DeadmanActive: undefined;
  OEMHelp: undefined;
  LanguageSelectorApp: undefined;
  CircleDetail: { circleId: string };
  CircleCreate: undefined;
  CircleInvite: { circleId: string };
  SafetyPin: undefined;
};

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
