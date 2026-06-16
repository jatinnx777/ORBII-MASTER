import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/config/supabase_config.dart';
import 'supabase_service.dart';

/// Thin wrapper over Supabase auth — Google OAuth + phone OTP, matching the RN
/// `src/services/auth.ts` entry points. Profile hydration (profiles +
/// users_public) lands in Phase 2 alongside the profile feature.
class AuthService {
  AuthService._();

  static SupabaseClient get _c => SupabaseService.client;

  /// Launches Google OAuth via the system browser; returns to the app through
  /// the `com.orbii.app://login-callback` deep link (PKCE).
  static Future<void> signInWithGoogle() {
    return _c.auth.signInWithOAuth(
      OAuthProvider.google,
      redirectTo: SupabaseConfig.authRedirect,
      authScreenLaunchMode: LaunchMode.externalApplication,
    );
  }

  /// Apple OAuth (web flow on Android — same redirect handoff as Google).
  static Future<void> signInWithApple() {
    return _c.auth.signInWithOAuth(
      OAuthProvider.apple,
      redirectTo: SupabaseConfig.authRedirect,
      authScreenLaunchMode: LaunchMode.externalApplication,
    );
  }

  /// Sends a 6-digit OTP to an E.164 phone number.
  static Future<void> sendPhoneOtp(String phoneE164) {
    return _c.auth.signInWithOtp(phone: phoneE164);
  }

  /// Verifies the OTP and establishes a session.
  static Future<AuthResponse> verifyPhoneOtp({
    required String phoneE164,
    required String token,
  }) {
    return _c.auth.verifyOTP(
      type: OtpType.sms,
      phone: phoneE164,
      token: token,
    );
  }

  static Future<void> signOut() => _c.auth.signOut();

  static Session? get currentSession => _c.auth.currentSession;

  /// Emits on every auth change (sign-in, sign-out, token refresh).
  static Stream<AuthState> get onAuthStateChange => _c.auth.onAuthStateChange;
}
