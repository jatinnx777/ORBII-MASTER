import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { UserProfile } from '@/types';
import { supabase } from './supabase';
import { listFriendsForUser } from './friend-requests';
import { syncUsersPublic } from './users-public';
import { syncProfile } from './profile-sync';
import { uploadAvatar } from './avatars';
import { loadEmergencyContacts } from './emergency-contacts';
import { mergeCachedProfile } from './profile-cache';
import { fetchSOSHistory } from './sos-history';
import { isValidIndianPhone, toE164India } from '@/utils/validation';
import { claimThisDevice } from './session-guard';

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

// PHONE OTP TEST BYPASS — accepts a hard-coded OTP for phone sign-in so
// we can demo the flow before wiring a real SMS gateway (Twilio /
// MessageBird etc.). When enabled:
//   • sendPhoneOtp does NOT call Supabase; just returns the E.164 number.
//   • verifyPhoneOtp accepts only TEST_OTP_CODE and returns a fake
//     profile with `needsProfile: true` so the user lands in ProfileSetup.
//   • No real Supabase session is created, so server-side calls
//     (friends search, messages, sos broadcast) will fail until you
//     either flip this off OR configure Supabase Phone Auth properly.
// DISABLED for launch — ORBII uses Google sign-in only. The phone/OTP flow is
// retired (no real SMS gateway wired), and the Welcome screen no longer routes
// to it. Keeping the constant (false) so the phone screens still compile.
const TEST_OTP_BYPASS = false;
const TEST_OTP_CODE = '123456';

WebBrowser.maybeCompleteAuthSession();

export type SignInResult = {
  profile: UserProfile;
  needsProfile: boolean;
  // SOS history pulled from the server alongside the profile. The
  // LoginScreen dispatches this into the history slice so the records
  // tab is populated immediately on sign-in.
  history: import('@/types').SOSRecord[];
};

// Sends a 6-digit OTP to the given phone via Supabase Auth (Phone
// provider). Requires the Supabase project's Auth → Phone settings to
// have a configured SMS gateway (Twilio / MessageBird / Vonage / built-in
// test mode). The caller surfaces success/failure as UI state — this
// function only throws on hard transport errors.
export async function sendPhoneOtp(rawPhone: string): Promise<string> {
  if (!isValidIndianPhone(rawPhone)) {
    throw new Error('Enter a valid 10-digit Indian mobile number.');
  }
  // Bypass paths short-circuit before hitting Supabase. UI still feels
  // like an OTP was sent.
  if (DEV_AUTH_MODE || TEST_OTP_BYPASS) {
    await delay(400);
    return toE164India(rawPhone);
  }
  const phone = toE164India(rawPhone);
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) {
    throw new Error(error.message);
  }
  return phone;
}

// Country-agnostic variant: the caller has already built a full E.164 number
// (dial code + national number) from the country picker.
export async function sendOtpToE164(e164: string): Promise<string> {
  if (!/^\+\d{7,15}$/.test(e164)) {
    throw new Error('Enter a valid mobile number.');
  }
  if (DEV_AUTH_MODE || TEST_OTP_BYPASS) {
    await delay(400);
    return e164;
  }
  const { error } = await supabase.auth.signInWithOtp({ phone: e164 });
  if (error) throw new Error(error.message);
  return e164;
}

// ── Email OTP (free on Supabase; no SMS gateway needed) ──────────────────
// Sends a 6-digit code. NOTE: Supabase's default email template sends a magic
// LINK — switch the "Magic Link" template to use {{ .Token }} to get a code.
export async function sendEmailOtp(email: string): Promise<string> {
  const clean = email.trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) throw new Error('Enter a valid email address.');
  if (DEV_AUTH_MODE || TEST_OTP_BYPASS) {
    await delay(400);
    return clean;
  }
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: true },
  });
  if (error) throw new Error(error.message);
  return clean;
}

export async function verifyEmailOtp(
  email: string,
  code: string,
): Promise<SignInResult> {
  const cleaned = code.replace(/\D/g, '');
  if (DEV_AUTH_MODE || TEST_OTP_BYPASS) {
    await delay(500);
    if (cleaned !== TEST_OTP_CODE) {
      throw new Error(`Test mode is on. Use ${TEST_OTP_CODE} as the OTP.`);
    }
    const profile = emptyProfile({ uid: `test_${cleaned}`, email, name: null, photo: null });
    return { profile, needsProfile: true, history: [] };
  }
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: cleaned,
    type: 'email',
  });
  if (error || !data?.user) {
    throw new Error(error?.message ?? 'OTP verification failed.');
  }
  return bootstrapProfile(data.user);
}

// Verifies the OTP, exchanges it for a session, then runs the same
// profile-bootstrap flow as Google sign-in (fetches/creates profile,
// hydrates friends + emergency contacts + history).
export async function verifyPhoneOtp(
  phoneE164: string,
  code: string,
): Promise<SignInResult> {
  const cleaned = code.replace(/\D/g, '');

  // Hard-coded test path. Returns a local-only profile so the user can
  // walk the post-signin flow without a real Supabase session. Server
  // calls (Supabase reads/writes) will fail under this path — fine for
  // UI demos, not for production.
  if (DEV_AUTH_MODE || TEST_OTP_BYPASS) {
    await delay(500);
    if (cleaned !== TEST_OTP_CODE) {
      throw new Error(`Test mode is on. Use ${TEST_OTP_CODE} as the OTP.`);
    }
    const profile = emptyProfile({
      uid: `test_${phoneE164.replace(/\D/g, '')}`,
      email: '',
      name: null,
      photo: null,
    });
    profile.phone = phoneE164;
    return { profile, needsProfile: true, history: [] };
  }

  if (cleaned.length < 4) {
    throw new Error('Enter the 6-digit OTP you received.');
  }
  const { data: sessionData, error: verifyError } = await supabase.auth.verifyOtp({
    phone: phoneE164,
    token: cleaned,
    type: 'sms',
  });
  if (verifyError || !sessionData?.user) {
    throw new Error(verifyError?.message ?? 'OTP verification failed.');
  }
  const user = sessionData.user;
  return bootstrapProfile(user, { fallbackPhone: phoneE164 });
}

// Shared post-signin bootstrap: pulls profile, friends, contacts,
// history. Extracted from signInWithGoogle so both auth paths converge
// on the same flow. Returns a `SignInResult` ready to dispatch.
async function bootstrapProfile(
  user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> },
  opts: { fallbackPhone?: string } = {},
): Promise<SignInResult> {
  // This is a fresh sign-in with a live session: claim this device as the
  // account's one active device, evicting whatever device was signed in before.
  void claimThisDevice();

  let { data: row } = await supabase
    .from('profiles')
    .select(
      'id, email, username, name, phone, photo_uri, is_helper, is_verified, created_at, username_changed_at, photo_changed_at',
    )
    .eq('id', user.id)
    .maybeSingle<ProfileRow>();

  if (!row) {
    const fallbackUsername = await ensureFallbackProfile(user);
    if (fallbackUsername) {
      const { data: refreshed } = await supabase
        .from('profiles')
        .select(
          'id, email, username, name, phone, photo_uri, is_helper, is_verified, created_at, username_changed_at, photo_changed_at',
        )
        .eq('id', user.id)
        .maybeSingle<ProfileRow>();
      row = refreshed ?? null;
    }
  }

  const [friends, emergencyContacts, history] = await Promise.all([
    listFriendsForUser(user.id),
    // Merges the server list with the durable local cache and repairs any
    // contact that never uploaded, so a guardian number survives sign-out.
    loadEmergencyContacts(user.id),
    fetchSOSHistory(user.id),
  ]);

  if (row) {
    let profile = rowToProfile(row, user.email ?? '');
    profile.friends = friends;
    profile.emergencyContacts = emergencyContacts;
    if (!profile.phone && opts.fallbackPhone) profile.phone = opts.fallbackPhone;
    // Restore anything the server didn't have (e.g. the profiles sync silently
    // failed) so a name/photo/username survives sign-out → sign-in.
    profile = await mergeCachedProfile(profile);
    if (profile.username) {
      syncUsersPublic(profile).catch(() => undefined);
    }
    return {
      profile,
      needsProfile: !profile.username || !profile.phone,
      history,
    };
  }

  let profile = emptyProfile({
    uid: user.id,
    email: user.email ?? '',
    name: (user.user_metadata?.full_name as string | undefined) ?? null,
    photo: (user.user_metadata?.avatar_url as string | undefined) ?? null,
  });
  profile.friends = friends;
  profile.emergencyContacts = emergencyContacts;
  if (opts.fallbackPhone) profile.phone = opts.fallbackPhone;
  // No server row (table missing, or first sign-in on a fresh project): fall
  // back to whatever this user last had on this device.
  profile = await mergeCachedProfile(profile);
  return {
    profile,
    needsProfile: !profile.username || !profile.phone,
    history,
  };
}

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
    isPremium: false,
    createdAt: Date.now(),
    usernameChangedAt: null,
    photoChangedAt: args.photo ? Date.now() : null,
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

// Last-line-of-defence profile creator. The DB trigger in
// sql/04_profile_triggers.sql is the primary path — this is here for
// projects that haven't installed the trigger yet, or for the rare case
// where the trigger fires but RLS blocks SELECT immediately after.
//
// Generates a placeholder username derived from the email so the user is
// findable in search before they finish ProfileSetup.
async function ensureFallbackProfile(user: {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const local = (user.email ?? '').split('@')[0] ?? '';
  const sanitized = local.toLowerCase().replace(/[^a-z0-9_]/g, '');
  let candidate =
    sanitized.length >= 3
      ? sanitized.slice(0, 16)
      : `orbii_${user.id.replace(/-/g, '').slice(0, 8)}`;

  // Walk a small suffix counter to dodge a duplicate-username collision.
  for (let i = 0; i < 6; i++) {
    const tryName = i === 0 ? candidate : `${candidate.slice(0, 14)}_${i}`;
    const { data: existing } = await supabase
      .from('users_public')
      .select('id')
      .eq('username', tryName)
      .maybeSingle();
    if (!existing) {
      candidate = tryName;
      break;
    }
  }

  const fullName =
    typeof user.user_metadata?.full_name === 'string'
      ? (user.user_metadata.full_name as string)
      : null;
  const avatarUrl =
    typeof user.user_metadata?.avatar_url === 'string'
      ? (user.user_metadata.avatar_url as string)
      : null;

  const { error: profileError } = await supabase.from('profiles').upsert(
    {
      id: user.id,
      email: user.email ?? null,
      username: candidate,
      name: fullName,
      photo_uri: avatarUrl,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (profileError) {
    console.warn('[auth] fallback profile insert failed:', profileError.message);
    return null;
  }

  // Mirror to users_public so search picks them up.
  const { error: publicError } = await supabase.from('users_public').upsert(
    {
      id: user.id,
      username: candidate,
      name: fullName,
      photo_url: avatarUrl,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  );
  if (publicError) {
    console.warn('[auth] fallback users_public insert failed:', publicError.message);
  }

  return candidate;
}

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
    isPremium: false,
    createdAt: row.created_at ? Date.parse(row.created_at) : Date.now(),
    usernameChangedAt: row.username_changed_at
      ? Date.parse(row.username_changed_at)
      : null,
    photoChangedAt: row.photo_changed_at
      ? Date.parse(row.photo_changed_at)
      : null,
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
    return { profile, needsProfile: true, history: [] };
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

  // 4. Hand off to the shared bootstrap that fetches/creates the
  //    profile and hydrates friends + contacts + history. Identical
  //    flow for Google and Phone sign-in.
  return bootstrapProfile(user);
}

export async function signOutFromGoogle(): Promise<void> {
  if (DEV_AUTH_MODE) return;
  try {
    await supabase.auth.signOut();
  } catch {
    // best effort
  }
}

// Permanently delete the signed-in user's account + ALL their data (Play Store
// requirement). Wipes every table server-side via delete_my_account (sql/28),
// then signs out locally. Returns ok/error so the UI can report failure.
export async function deleteAccount(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.rpc('delete_my_account');
    if (error) return { ok: false, error: error.message };
    try {
      await supabase.auth.signOut();
    } catch {
      // session may already be invalid after the auth user is removed
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete failed' };
  }
}

export async function updateProfile(
  current: UserProfile,
  updates: { name: string; photoUri: string | null; username?: string | null },
): Promise<UserProfile> {
  // Upload a newly-picked local photo so it survives sign-out / re-login.
  const photoUri = await uploadAvatar(current.uid, updates.photoUri);
  const updated: UserProfile = {
    ...current,
    name: updates.name.trim(),
    photoUri,
    username:
      updates.username !== undefined ? updates.username : current.username,
    photoChangedAt: photoUri !== current.photoUri ? Date.now() : current.photoChangedAt,
  };
  // Persist name / username / photo to Supabase (profiles + users_public) so
  // the next sign-in loads the new values instead of the old ones.
  await syncProfile(updated);
  return updated;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const DEV_AUTH = {
  enabled: DEV_AUTH_MODE,
};
