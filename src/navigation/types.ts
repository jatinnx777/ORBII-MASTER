import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  PhoneSignIn: undefined;
  // OTP entry — either a phone (SMS) or an email code.
  PhoneVerify: { phone?: string; email?: string };
  LanguageSelector: undefined;
  ProfileSetup: undefined;
  // Note: IdVerification removed alongside the helper system cut.
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type TabParamList = {
  Home: undefined;
  Community: undefined;
  // The safety toolbox. Shown as the "Safety" side tab; the centre SOS button
  // is a raised action, not a tab.
  Emergency: undefined;
  // Responder-only tab (rendered only when role is responder/admin).
  Missions: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  SOSCountdown:
    | {
        instant?: boolean;
        test?: boolean;
        voice?: boolean;
        /** Which phrase/sound fired the voice trigger — for false-positive tuning. */
        phrase?: string;
        /** Absolute path to the pre-roll WAV captured before the trigger. */
        preroll?: string;
      }
    | undefined;
  ActiveSOS: undefined;
  // Victim-facing "help is coming" screen shown once a helper accepts. All
  // params optional so it degrades gracefully if some data isn't in yet.
  HelperResponse:
    | {
        name?: string;
        phone?: string | null;
        photoUri?: string | null;
        vehicle?: string;
        distanceM?: number;
        etaMin?: number;
        helperLat?: number;
        helperLng?: number;
        victimLat?: number;
        victimLng?: number;
      }
    | undefined;
  IncidentDetail: { recordId: string };
  EmergencyContacts: undefined;
  SafetyReadiness: undefined;
  Geofences: undefined;
  Recordings: undefined;
  DisasterMode: undefined;
  BluetoothChat: undefined;
  NearbyPeople: undefined;
  DmThread: { peerPublicB64: string; peerNick: string };
  OfflineHelperAlert: { alertId: string };
  CommunityFeed: undefined;
  CommunityProfileSetup: undefined;
  CommunityUserProfile: { profileId: string };
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
  HelperAlert: { alertId: string };
  HelperNavigation: {
    sosId: string;
    name: string;
    phone: string;
    lat: number;
    lng: number;
    photoUri?: string | null;
    victimId?: string;
    sosCreatedMs?: number;
  };
  // Settings + Circles are now stack destinations (reached via the Home
  // gear / helpers row), not tabs — the tab bar is Home/Safety/Plans/Profile.
  Settings: undefined;
  Circles: undefined;
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
  VoicePhrases: undefined;
  VoiceDebug: undefined;
  // Responder onboarding (the Missions dashboard itself is a role-gated tab).
  ResponderApplication: undefined;
  ResponderVerification: undefined;
  ResponderRecognition: undefined;
  ResponderEarnings: undefined;
  WalkWithMe: undefined;
};

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
