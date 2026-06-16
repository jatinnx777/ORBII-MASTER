import 'dart:async';
import 'package:app_links/app_links.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'router/app_router.dart';
import 'services/circles_service.dart';

/// Root widget — `MaterialApp.router` wired to the auth-gated GoRouter, plus a
/// deep-link listener that turns `orbii://voice-sos` (fired by the native Voice
/// SOS service) into an instant SOS.
class OrbiiApp extends ConsumerStatefulWidget {
  const OrbiiApp({super.key});

  @override
  ConsumerState<OrbiiApp> createState() => _OrbiiAppState();
}

class _OrbiiAppState extends ConsumerState<OrbiiApp> {
  final _appLinks = AppLinks();
  StreamSubscription<Uri>? _sub;

  @override
  void initState() {
    super.initState();
    _initDeepLinks();
  }

  Future<void> _initDeepLinks() async {
    final initial = await _appLinks.getInitialLink();
    if (initial != null) _handle(initial);
    _sub = _appLinks.uriLinkStream.listen(_handle);
  }

  void _handle(Uri uri) {
    if (uri.scheme == 'orbii' && uri.host == 'voice-sos') {
      ref.read(routerProvider).go('${Routes.sosCountdown}?instant=true');
      return;
    }
    // Circle invite links: orbii://join/<token> or .../join/<token>.
    final token = _joinToken(uri);
    if (token != null) {
      _acceptInvite(token);
      return;
    }
    // Supabase OAuth redirects (orbii://auth/callback?code=…) are consumed by
    // supabase_flutter's own deep-link listener, which exchanges the PKCE code
    // for a session automatically; no action needed here.
  }

  String? _joinToken(Uri uri) {
    final segs = uri.pathSegments;
    if (uri.scheme == 'orbii' && uri.host == 'join' && segs.isNotEmpty) {
      return segs.first;
    }
    // https://orbii.app/join/<token>
    if (segs.length >= 2 && segs.first == 'join') return segs[1];
    return null;
  }

  Future<void> _acceptInvite(String token) async {
    try {
      await CirclesService.acceptInviteByToken(token);
    } catch (_) {/* invalid/expired — silently ignore */}
    ref.read(routerProvider).go(Routes.circles);
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(routerProvider);
    return MaterialApp.router(
      title: 'ORBII',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light,
      routerConfig: router,
    );
  }
}
