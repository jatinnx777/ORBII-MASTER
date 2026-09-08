import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

/**
 * The SAME backend as the main ORBII app. Same project, same tables, same
 * row-level security.
 *
 * That is the entire reason this app is cheap to build. Every rule about who
 * may see which SOS already lives in Postgres, in orbii_can_access_sos(), and
 * it does not care which app is asking. This client gets exactly the access a
 * circle member has and not one row more, because the database decides, not
 * the code in front of it.
 *
 * The anon key is public by design. It is shipped inside the Android APK
 * already and it grants nothing on its own: every table worth protecting has
 * RLS on, and the sensitive ones have their grants revoked as a second layer.
 */
export const SUPABASE_URL = 'https://henbkyjefhzmxqozlczd.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlbmJreWplZmh6bXhxb3psY3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDkzNjksImV4cCI6MjA5MjEyNTM2OX0.JpNZwyzD75f75C8FNztE8_GMDAJKI-UKJMps6larhcA';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar for a magic link to land in, so there is no
    // session to detect in one.
    detectSessionInUrl: false,
  },
});
