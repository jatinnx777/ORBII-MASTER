import Constants from 'expo-constants';
import type { UserProfile } from '@/types';

// Lazy-loaded native module. Importing `@react-native-google-signin/...` at
// the top level triggers a TurboModule lookup that crashes Expo Go (the
// native side isn't there). We only require() it when DEV_AUTH_MODE is off.
type GoogleSigninLib = typeof import('@react-native-google-signin/google-signin');
let googleLib: GoogleSigninLib | null = null;

function loadGoogleLib(): GoogleSigninLib {
  if (googleLib) return googleLib;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  googleLib = require('@react-native-google-signin/google-signin') as GoogleSigninLib;
  return googleLib;
}

// ORBII auth service — Google Sign-In.
//
// We replaced phone+OTP with Google Sign-In to skip Firebase phone auth's
// reCAPTCHA pain and to give the user a one-tap sign-in. The Google account
// gives us a verified identity (email, name, photo) for free.
//
// One-time setup the project owner must do in Google Cloud Console:
//   1. Create OAuth 2.0 client of type "Web application" — copy the Client ID
//      into app.json -> extra.googleWebClientId.
//   2. Create OAuth 2.0 client of type "Android" — package name `com.orbii.app`
//      and the SHA-1 fingerprint of the release keystore.
//   3. Enable the "Google Identity Services" API.
// Without those, signInWithGoogle() will throw `DEVELOPER_ERROR`.
//
// While Google Cloud is being set up we keep DEV_AUTH_MODE = true so the UI
// flow still works on a developer build with a fake profile. Sign-in returns
// a local-only profile — no Google call, no real identity, no backend.
const DEV_AUTH_MODE = true;

const webClientId =
  (Constants.expoConfig?.extra as { googleWebClientId?: string } | undefined)
    ?.googleWebClientId ?? '';

let googleConfigured = false;

function ensureGoogleConfigured() {
  if (googleConfigured) return;
  const { GoogleSignin } = loadGoogleLib();
  GoogleSignin.configure({
    webClientId,
    offlineAccess: false,
    scopes: ['profile', 'email'],
  });
  googleConfigured = true;
}

export type SignInResult = {
  profile: UserProfile;
  needsProfile: boolean;
};

function profileFromGoogle(args: {
  uid: string;
  email: string;
  name: string | null;
  photo: string | null;
}): UserProfile {
  return {
    uid: args.uid,
    email: args.email,
    phone: null,
    name: args.name,
    username: null,
    photoUri: args.photo,
    emergencyContacts: [],
    friends: [],
    isHelper: false,
    isPremium: false,
    createdAt: Date.now(),
    idKind: null,
    idNumber: null,
    idPhotoUri: null,
    idVerification: 'unverified',
  };
}

export async function signInWithGoogle(): Promise<SignInResult> {
  if (DEV_AUTH_MODE) {
    await delay(400);
    // Empty email + name in dev mode so any pre-fill (waitlist sheets,
    // edit-profile) starts blank rather than showing a placeholder dev
    // address from the source.
    const profile = profileFromGoogle({
      uid: `dev_${Date.now()}`,
      email: '',
      name: null,
      photo: null,
    });
    return { profile, needsProfile: true };
  }

  if (!webClientId || webClientId.startsWith('REPLACE_')) {
    throw new Error(
      'Google sign-in is not configured yet. Ask the project owner to set ' +
        'extra.googleWebClientId in app.json with the Web OAuth Client ID ' +
        'from Google Cloud Console.',
    );
  }

  ensureGoogleConfigured();
  const { GoogleSignin, statusCodes } = loadGoogleLib();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const result = await GoogleSignin.signIn();
    // RNGS v13+ returns { type: 'success'|'cancelled', data?: User }.
    // Older builds returned the user directly. Handle both shapes.
    const user =
      // @ts-expect-error — runtime shape check across library versions.
      result?.data?.user ?? result?.user ?? result;
    if (!user || !user.id) {
      throw new Error('Google sign-in was cancelled.');
    }
    const profile = profileFromGoogle({
      uid: `google_${user.id}`,
      email: user.email ?? '',
      name: user.name ?? null,
      photo: user.photo ?? null,
    });
    return { profile, needsProfile: !user.name };
  } catch (err: unknown) {
    const e = err as { code?: string; message?: string };
    if (e?.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Sign-in cancelled.');
    }
    if (e?.code === statusCodes.IN_PROGRESS) {
      throw new Error('Sign-in already in progress.');
    }
    if (e?.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
      throw new Error('Google Play Services not available on this device.');
    }
    if (e?.code === 'DEVELOPER_ERROR') {
      throw new Error(
        "Google sign-in misconfigured. The app's SHA-1 fingerprint or " +
          'package name does not match the OAuth client in Google Cloud ' +
          'Console.',
      );
    }
    throw new Error(e?.message ?? 'Google sign-in failed.');
  }
}

export async function signOutFromGoogle(): Promise<void> {
  if (DEV_AUTH_MODE) return;
  try {
    ensureGoogleConfigured();
    const { GoogleSignin } = loadGoogleLib();
    await GoogleSignin.signOut();
  } catch {
    // Ignore — sign-out best effort.
  }
}

export async function updateProfile(
  current: UserProfile,
  updates: { name: string; photoUri: string | null; username?: string | null },
): Promise<UserProfile> {
  await delay(300);
  return {
    ...current,
    name: updates.name.trim(),
    photoUri: updates.photoUri,
    username: updates.username !== undefined ? updates.username : current.username,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEV_AUTH = {
  enabled: DEV_AUTH_MODE,
};
