/// Supabase connection — the SAME project the React Native app uses. The anon
/// key is public by design (Row-Level Security is the real protection, see
/// `sql/`). Never put the service_role key here.
class SupabaseConfig {
  SupabaseConfig._();

  static const url = 'https://henbkyjefhzmxqozlczd.supabase.co';

  static const anonKey =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhlbmJreWplZmh6bXhxb3psY3pkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDkzNjksImV4cCI6MjA5MjEyNTM2OX0.JpNZwyzD75f75C8FNztE8_GMDAJKI-UKJMps6larhcA';

  /// Deep-link scheme used for the OAuth redirect handoff (mirrors RN's
  /// `orbii://` PKCE redirect). Registered in AndroidManifest.xml.
  static const authRedirect = 'com.orbii.app://login-callback';
}
