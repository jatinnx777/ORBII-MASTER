export type EmergencyContact = {
  id: string;
  name: string;
  phone: string;
  relation: string;
};

export type Friend = {
  username: string;
  addedAt: number;
  // Hydrated from users_public on sign-in / friend accept. Falls back
  // gracefully when the public row hasn't synced yet.
  uid?: string | null;
  name?: string | null;
  photoUri?: string | null;
};

// ORBII is a single app with role-based access (like Instagram user/creator or
// LinkedIn user/recruiter). The role gates navigation + permissions; a normal
// user never sees responder UI. Stored on the profile, source of truth is the
// `profiles.role` column (changed by admin approval).
export type UserRole = 'user' | 'responder' | 'admin';

export type UserProfile = {
  uid: string;
  email: string;
  phone: string | null;
  name: string | null;
  // Defaults to 'user'. Becomes 'responder' after an approved application.
  role?: UserRole;
  // Public handle the user picks during profile setup. Other users add
  // each other to their safety circle by typing this username.
  username: string | null;
  photoUri: string | null;
  emergencyContacts: EmergencyContact[];
  // Friends added by username. Stored locally for now; once a Supabase
  // profiles table exists we can resolve these to real user records.
  friends: Friend[];
  isPremium: boolean;
  // Which paid tier the user is on. 'plus' = ₹99, 'family' = ₹299. Drives the
  // Plans screen so we never re-sell a plan someone already owns and only
  // offer a genuine upgrade (Plus → Family).
  premiumTier?: 'plus' | 'family' | null;
  createdAt: number;
  // Cooldown timestamps. After picking a username or profile photo the
  // user can't change it again for 30 days. Stored on the device AND
  // mirrored to the profiles table so the limit holds across reinstalls.
  usernameChangedAt: number | null;
  photoChangedAt: number | null;
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

// 'real' = the user pressed the SOS button, alerted everyone in their circle.
// 'test' = practice SOS from Settings. No one is notified.
export type SOSKind = 'real' | 'test';

// Summary of someone who responded to an SOS, a circle member who tapped
// "I'm coming to help". Used by the SOS detail screen + history.
export type Responder = {
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
  kind?: SOSKind;
  responders: Responder[];
  responder: Responder | null;
  responseTime: number | null;
  resolvedAt: number | null;
  rating: number | null;
};

export type LocationPermissionStatus =
  | 'unknown'
  | 'granted'
  | 'denied'
  | 'restricted';

// CommunityAlert = an active SOS that anyone in the victim's circle can
// respond to. Circle-scoped, not stranger-broadcast.
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
