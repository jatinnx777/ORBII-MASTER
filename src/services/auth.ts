import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { UserProfile } from '@/types';
import { supabase } from './supabase';

// Custom URL scheme registered in app.json. Redirect URI must be hard-coded
// so it stays stable across Expo Go vs production builds (where
// Linking.createURL returns different things). This exact value must be
// listed under Supabase Dashboard → Authentication → URL Configuration →
// Additional Redirect URLs.
export const AUTH_REDIRECT_URL = 'orbii://auth/callback';

// ORBII auth — Supabase OAuth (Google provider) via the browser.
//
// One-time setup the project owner has to do:
//   1. Google Cloud Console → create a Web OAuth client. Copy ID + Secret.
//   2. Supabase Dashboard → Authentication → Providers → Google → toggle on
//      and paste the Client ID and Client Secret. Save.
//   3. Copy the redirect URL Supabase shows you and add it as an Authorized
//      redirect URI on the Google OAuth client. (We configured it as
//      `https://{project}.supabase.co/auth/v1/callback`.)
//
// Once that's live, signInWithGoogle() opens the system browser, the user
// picks a Google account, Supabase issues a real session, and we read the
// user from `auth.users`. The first time a user signs in, profileFromAuthUser
// is used to seed an empty profile and `needsProfile: true` is returned so
// ProfileSetup runs.
//
// While Supabase is being set up, set DEV_AUTH_MODE = true to short-circuit
// to a local-only fake profile. The UI flow stays identical.
const DEV_AUTH_MODE = false;

WebBrowser.maybeCompleteAuthSession();

export type SignInResult = {
  profile: UserProfile;
  needsProfile: boolean;
};

function emptyProfile(args: {
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
    usernameChangedAt: null,
    photoChangedAt: args.photo ? Date.now() : null,
    idKind: null,
    idNumber: null,
    idPhotoUri: null,
    idVerification: 'unverified',
  };
}

type ProfileRow = {
  id: string;
  email: string | null;
  username: string | null;
  name: string | null;
  phone: string | null;
  photo_uri: string | null;
  is_helper: boolean | null;
  is_verified: boolean | null;
  created_at?: string;
  username_changed_at?: string | null;
  photo_changed_at?: string | null;
};

function rowToProfile(row: ProfileRow, fallbackEmail: string): UserProfile {
  return {
    uid: row.id,
    email: row.email ?? fallbackEmail,
    phone: row.phone ?? null,
    name: row.name ?? null,
    username: row.username ?? null,
    photoUri: row.photo_uri ?? null,
    emergencyContacts: [],
    friends: [],
    isHelper: !!row.is_helper,
    isPremium: false,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    usernameChangedAt: row.username_changed_at
      ? Date.parse(row.username_changed_at)
      : null,
    photoChangedAt: row.photo_changed_at
      ? Date.parse(row.photo_changed_at)
      : null,
    idKind: null,
    idNumber: null,
    idPhotoUri: null,
    idVerification: row.is_verified ? 'verified' : 'unverified',
  };
}

export async function signInWithGoogle(): Promise<SignInResult> {
  if (DEV_AUTH_MODE) {
    await delay(400);
    const profile = emptyProfile({
      uid: `dev_${Date.now()}`,
      email: '',
      name: null,
      photo: null,
    });
    return { profile, needsProfile: true };
  }

  // 1. Tell Supabase we want the Google OAuth URL. We pass our own
  //    deep-link as redirectTo so Supabase bounces the user back into the
  //    app after Google completes. Hard-coded so the value is identical
  //    in Expo Go, production APK, and the Supabase allow-list.
  const { data: oauth, error: oauthError } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (oauthError || !oauth?.url) {
    throw new Error(
      oauthError?.message ??
        'Could not start Google sign-in. Make sure the Google provider is enabled in Supabase.',
    );
  }

  // 2. Open the OAuth URL in the in-app browser. WebBrowser handles the
  //    return-to-app step by listening for the redirect URL.
  const result = await WebBrowser.openAuthSessionAsync(
    oauth.url,
    AUTH_REDIRECT_URL,
  );
  if (result.type !== 'success' || !result.url) {
    throw new Error('Sign-in cancelled.');
  }

  // 3. Pull the auth code out of the redirect URL and exchange it for a
  //    Supabase session.
  const parsed = Linking.parse(result.url);
  const code = parsed.queryParams?.code;
  if (!code || typeof code !== 'string') {
    throw new Error('Missing auth code in redirect URL.');
  }
  const { data: sessionData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !sessionData?.user) {
    throw new Error(exchangeError?.message ?? 'Sign-in failed.');
  }
  const user = sessionData.user;

  // 4. Look up an existing profiles row for this user. If the row exists,
  //    they're a returning user; if not, ProfileSetup will fire.
  const { data: row } = await supabase
    .from('profiles')
    .select(
      'id, email, username, name, phone, photo_uri, is_helper, is_verified, created_at, username_changed_at, photo_changed_at',
    )
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (row) {
    const profile = rowToProfile(row, user.email ?? '');
    return { profile, needsProfile: !profile.username || !profile.phone };
  }

  const profile = emptyProfile({
    uid: user.id,
    email: user.email ?? '',
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    photo: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  return { profile, needsProfile: true };
}

export async function signOutFromGoogle(): Promise<void> {
  if (DEV_AUTH_MODE) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // best effort
  }
}

export async function updateProfile(
  current: UserProfile,
  updates: { name: string; photoUri: string | null; username?: string | null },
): Promise<UserProfile> {
  await delay(150);
  return {
    ...current,
    name: updates.name.trim(),
    photoUri: updates.photoUri,
    username:
      updates.username !== undefined ? updates.username : current.username,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEV_AUTH = {
  enabled: DEV_AUTH_MODE,
};
