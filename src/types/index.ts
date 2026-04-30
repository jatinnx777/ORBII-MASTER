export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relation: string;
};

export type IdDocumentKind = 'aadhaar' | 'pan';

export type IdVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected';

export type Friend = {
  username: string;
  addedAt: number;
};

export type UserProfile = {
  uid: string;
  email: string;
  phone: string | null;
  name: string | null;
  // Public handle the user picks during profile setup. Other users add
  // each other to their safety circle by typing this username.
  username: string | null;
  photoUri: string | null;
  emergencyContacts: EmergencyContact[];
  // Friends added by username. Stored locally for now; once a Supabase
  // profiles table exists we can resolve these to real user records.
  friends: Friend[];
  isHelper: boolean;
  isPremium: boolean;
  createdAt: number;
  // Cooldown timestamps. After picking a username or profile photo the
  // user can't change it again for 30 days. Stored on the device AND
  // mirrored to the profiles table so the limit holds across reinstalls.
  usernameChangedAt: number | null;
  photoChangedAt: number | null;
  idKind: IdDocumentKind | null;
  idNumber: string | null;
  idPhotoUri: string | null;
  idVerification: IdVerificationStatus;
};

export type AuthStatus =
  | 'idle'
  | 'signing_in'
  | 'authenticated'
  | 'needs_profile'
  | 'error';

export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type SOSLocation = GeoPoint & {
  address: string | null;
};

export type SOSStatus = 'active' | 'resolved' | 'cancelled';

// 'real' = the user pressed the SOS button. Helpers were notified.
// 'test' = the user fired a practice SOS from Settings. NO helpers notified.
export type SOSKind = 'real' | 'test';

export type HelperSummary = {
  id: string;
  name: string;
  photoUri: string | null;
  rating: number;
};

export type SOSRecord = {
  id: string;
  userId: string;
  userName: string | null;
  userPhoto: string | null;
  location: SOSLocation;
  timestamp: number;
  status: SOSStatus;
  // 'test' SOS records originate from Settings → Trigger test SOS. No real
  // helpers are notified. Defaults to 'real' for backwards compat with
  // already-persisted history rows.
  kind?: SOSKind;
  helpers: HelperSummary[];
  responder: HelperSummary | null;
  responseTime: number | null;
  resolvedAt: number | null;
  rating: number | null;
};

export type LocationPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'restricted';

export type HelperVerificationStatus =
  | 'unverified'
  | 'pending'
  | 'verified'
  | 'rejected';

export type HelperJobStatus =
  | 'idle'
  | 'incoming'
  | 'accepted'
  | 'en_route'
  | 'arrived'
  | 'completed'
  | 'declined';

export type HelperJob = {
  id: string;
  user: {
    id: string;
    name: string;
    photoUri: string | null;
    phone: string;
  };
  location: SOSLocation;
  distanceMeters: number;
  etaSeconds: number;
  reward: number;
  createdAt: number;
};

// CommunityAlert = an active SOS that any nearby user (not just verified
// helpers) can respond to. This is the "good samaritan" flow — if there are
// N users near a victim, any of them can step up.
export type CommunityAlert = {
  id: string;
  victim: {
    id: string;
    name: string;
    photoUri: string | null;
    phone: string | null;
  };
  location: SOSLocation;
  distanceMeters: number;
  etaSeconds: number;
  createdAt: number;
  respondersCount: number;
};

export type HelperState = {
  mode: boolean;
  verification: HelperVerificationStatus;
  rating: number;
  totalJobs: number;
  livesSaved: number;
  balance: number;
  pendingBalance: number;
  currentJob: HelperJob | null;
  jobStatus: HelperJobStatus;
};
