import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

export type AuthStackParamList = {
  Welcome: undefined;
  Login: undefined;
  PhoneSignIn: undefined;
  // OTP entry, either a phone (SMS) or an email code.
  PhoneVerify: { phone?: string; email?: string };
  LanguageSelector: undefined;
  ProfileSetup: undefined;
  // Note: IdVerification removed alongside the helper system cut.
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type TabParamList = {
  Home: undefined;
  Circles: undefined;
  // The safety toolbox. Shown as the "Safety" side tab; the centre SOS button
  // is a raised action, not a tab.
  Emergency: undefined;
  Profile: undefined;
};

export type AppStackParamList = {
  Tabs: { screen?: keyof TabParamList } | undefined;
  SOSCountdown:
    | {
        instant?: boolean;
        test?: boolean;
        voice?: boolean;
        /**
         * The accelerometer detected a hard impact followed by stillness and
         * she did not move afterwards. Changes the countdown copy and is
         * recorded on the SOS, so her circle is told a sensor raised this and
         * not a person, which is the difference between "call her" and "she
         * may be unable to answer".
         */
        impact?: boolean;
        /** Which phrase/sound fired the voice trigger, for false-positive tuning. */
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
  VoiceDonation: undefined;
  Geofences: undefined;
  Recordings: undefined;
  DisasterMode: undefined;
  ZoneEditor: undefined;
  CircleMap: undefined;
  TripReplay: { userId: string; name?: string };
  OfflineHelperAlert: { alertId: string };
  ContactForm: { contactId?: string };
  EditProfile: undefined;
  PremiumUpgrade: undefined;
  Checkout: undefined;
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
  // gear / helpers row), not tabs, the tab bar is Home/Safety/Plans/Profile.
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
  // The whole Visit is passed rather than an id: circle_visits pairs rows on
  // the fly, so a visit has no stable row of its own to refetch by.
  ActivityDetail: { visit: import('@/services/geofence').Visit };
  CircleCreate: undefined;
  CircleInvite: { circleId: string };
  SafetyPin: undefined;
  VoicePhrases: undefined;
  VoiceReliability: undefined;
  VoiceDebug: undefined;
  // Responder onboarding (the Missions dashboard itself is a role-gated tab).
  ResponderApplication: undefined;
  ResponderVerification: undefined;
  ResponderRecognition: undefined;
  ResponderEarnings: undefined;
  CoinsWallet: undefined;
  AdminResponders: undefined;
  // Responder dashboard (moved off the tab bar; reached from Profile).
  Missions: undefined;
  CommunityGuardian: undefined;
  WalkWithMe: undefined;
  HoldSafe: undefined;
};

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;

export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<AppStackParamList>
>;
