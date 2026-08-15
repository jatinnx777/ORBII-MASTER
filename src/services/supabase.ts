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
