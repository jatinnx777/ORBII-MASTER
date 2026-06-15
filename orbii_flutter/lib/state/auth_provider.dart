import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/auth_service.dart';

/// Streams Supabase auth changes. The router listens to this to gate screens
/// (replaces the RN Redux `userSlice` + navigation guard).
final authStateProvider = StreamProvider<AuthState>((ref) {
  return AuthService.onAuthStateChange;
});

/// Convenience: is there a live session right now? Derives from the stream but
/// falls back to the synchronously-available session at startup.
final isSignedInProvider = Provider<bool>((ref) {
  final state = ref.watch(authStateProvider);
  return state.maybeWhen(
    data: (s) => s.session != null,
    orElse: () => AuthService.currentSession != null,
  );
});
