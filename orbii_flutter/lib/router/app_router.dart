import 'dart:async';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../services/auth_service.dart';
import '../features/auth/sign_in_screen.dart';
import '../features/onboarding/onboarding_screen.dart';
import '../features/home/home_screen.dart';

/// App routes. Kept as constants so feature code can `context.go(Routes.home)`
/// without stringly-typed paths.
class Routes {
  Routes._();
  static const onboarding = '/onboarding';
  static const signIn = '/sign-in';
  static const home = '/';
}

/// GoRouter provider with an auth-aware redirect (replaces React Navigation's
/// conditional navigator). Rebuilds whenever Supabase auth changes.
final routerProvider = Provider<GoRouter>((ref) {
  final refresh = _GoRouterRefreshStream(AuthService.onAuthStateChange);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: Routes.home,
    refreshListenable: refresh,
    redirect: (context, state) {
      final signedIn = AuthService.currentSession != null;
      final loc = state.matchedLocation;
      final onAuthPages =
          loc == Routes.signIn || loc == Routes.onboarding;

      if (!signedIn && !onAuthPages) return Routes.signIn;
      if (signedIn && onAuthPages) return Routes.home;
      return null;
    },
    routes: [
      GoRoute(
        path: Routes.home,
        builder: (context, state) => const HomeScreen(),
      ),
      GoRoute(
        path: Routes.signIn,
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: Routes.onboarding,
        builder: (context, state) => const OnboardingScreen(),
      ),
    ],
  );
});

/// Bridges a [Stream] to a [Listenable] so GoRouter re-evaluates `redirect`
/// when auth state changes.
class _GoRouterRefreshStream extends ChangeNotifier {
  _GoRouterRefreshStream(Stream<dynamic> stream) {
    notifyListeners();
    _sub = stream.asBroadcastStream().listen((_) => notifyListeners());
  }

  late final StreamSubscription<dynamic> _sub;

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
