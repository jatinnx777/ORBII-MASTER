import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/config/supabase_config.dart';

/// Initialises the Supabase client once at startup and exposes the shared
/// instance. Mirrors RN's `src/services/supabase.ts`.
class SupabaseService {
  SupabaseService._();

  static Future<void> init() async {
    await Supabase.initialize(
      url: SupabaseConfig.url,
      // The project uses the legacy JWT anon key (not an sb_publishable_ key),
      // so `anonKey` is correct here despite the deprecation hint.
      // ignore: deprecated_member_use
      anonKey: SupabaseConfig.anonKey,
      authOptions: const FlutterAuthClientOptions(
        // PKCE matches the RN flow so the deep-link auth handoff works.
        authFlowType: AuthFlowType.pkce,
      ),
    );
  }

  static SupabaseClient get client => Supabase.instance.client;
}
