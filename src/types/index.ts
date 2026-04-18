export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relation: string;
};

export type UserProfile = {
  uid: string;
  phone: string;
  name: string | null;
  photoUri: string | null;
  emergencyContacts: EmergencyContact[];
  isHelper: boolean;
  isPremium: boolean;
  createdAt: number;
};

export type AuthStatus =
  | 'idle'
  | 'sending_otp'
  | 'otp_sent'
  | 'verifying_otp'
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
