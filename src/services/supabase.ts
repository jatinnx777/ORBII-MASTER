import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from './secure-store';

export const SUPABASE_URL = 'https://henbkyjefhzmxqozlczd.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlbmJreWplZmh6bXhxb3psY3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDkzNjksImV4cCI6MjA5MjEyNTM2OX0.JpNZwyzD75f75C8FNztE8_GMDAJKI-UKJMps6larhcA';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Hybrid storage, Supabase auth tokens (sb-* keys) go to SecureStore
    // (Android Keystore / iOS Keychain). Other persisted state stays on
    // AsyncStorage. See src/services/secure-store.ts.
    storage: secureStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    // PKCE flow returns the auth code as `?code=...` on the redirect URL
    // (which matches our exchangeCodeForSession call). Implicit flow puts
    // tokens in the URL fragment (#access_token=...) and would break the
    // mobile deep-link handoff.
    flowType: 'pkce',
  },
});

// The signed-in user, read from the session already held in memory.
//
// `supabase.auth.getUser()` is not a local read: it is a network round trip to
// /auth/v1/user on every call. The Supabase edge logs from 19 September 2026
// showed hundreds of them firing back to back, one per analytics event and one
// per circles read, and that queue is most of what people felt as "creating a
// circle takes minutes". getSession() reads memory and refreshes the token
// only when it has actually expired.
//
// Use this anywhere the user id is all that is needed. Call getUser() only
// when the token genuinely has to be revalidated against the server.
export async function currentUser() {
  return (await supabase.auth.getSession()).data.session?.user ?? null;
}
